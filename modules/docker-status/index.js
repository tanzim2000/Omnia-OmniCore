// modules/docker-control/index.js
// Reports what Docker is running on this machine.
// Read-only — it never starts or stops anything.
//
// Docker exposes a REST API over a unix socket rather than a network port,
// so we talk to it with Node's built-in http module pointed at that socket.
// No library needed.

const http = require("http");

const DOCKER_SOCKET = "/var/run/docker.sock";

// Make a GET request to Docker's API over its unix socket
function dockerRequest(path) {
	return new Promise((resolve, reject) => {
		const request = http.request(
			{ socketPath: DOCKER_SOCKET, path: path, method: "GET" },
			(response) => {
				let body = "";

				response.on("data", (chunk) => {
					body += chunk;
				});

				response.on("end", () => {
					try {
						resolve(JSON.parse(body));
					} catch (error) {
						reject(new Error("Docker returned something unreadable"));
					}
				});
			}
		);

		request.on("error", reject);
		request.end();
	});
}

// Docker reports names as ["/whoogle"] — strip the leading slash
function containerName(container) {
	const raw = (container.Names && container.Names[0]) || container.Id;
	return raw.replace(/^\//, "");
}

module.exports = function dockerControlModule(app, options) {
	app.get("/api/docker-status", async (req, res) => {
		try {
			// all=true so we see stopped containers too, not just running ones
			const containers = await dockerRequest("/containers/json?all=true");

			const running = containers.filter((c) => c.State === "running");

			// Running containers first, then everything else
			const sorted = [
				...running,
				...containers.filter((c) => c.State !== "running")
			];

			res.json({
				title: "Docker",
				primary: String(running.length),
				secondary: "of " + containers.length + " running",
				details: sorted.map((container) => ({
					label: containerName(container),
					value: container.Status || container.State
				})),
				updated: new Date().toISOString()
			});
		} catch (error) {
			// Docker isn't reachable — say so plainly rather than crashing.
			// Most likely there's no Docker on this machine, or OmniCore
			// can't read the socket.
			res.json({
				title: "Docker",
				primary: "—",
				secondary: "Not reachable",
				details: [
					{ label: "Socket", value: DOCKER_SOCKET }
				],
				updated: new Date().toISOString()
			});
		}
	});
};