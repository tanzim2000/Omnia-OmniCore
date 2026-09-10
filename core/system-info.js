// core/system-info.js
// What OmniCore can tell you about the machine it's running on.
//
// Everything here is read fresh on request rather than cached at boot:
// these are cheap reads, and a container that's been up for months
// shouldn't be reporting what was true the day it started.
//
// Every function fails soft and returns null rather than throwing. The
// About face is informational -- a missing Docker version should leave
// one row blank, never take the page down.

const fs = require("fs");

const { readFaces } = require("./face-store");
const { listModules } = require("./module-loader");
const themeLoader = require("./theme-loader");

// The host OS, from the standard file every Linux distribution ships.
// Inside a container this reports the IMAGE's OS (Alpine, since that's
// what the Dockerfile builds from), not the machine underneath -- which
// is the honest answer to "what is OmniCore running on", since that's
// the userland it actually executes against.
function readOperatingSystem() {
	try {
		const raw = fs.readFileSync("/etc/os-release", "utf-8");
		const match = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m);

		return match ? match[1] : null;
	} catch (error) {
		return null;
	}
}

// The container runtime's version, asked over the same Docker socket
// self-update already uses. Null when the socket isn't mounted, which
// is a legitimate configuration (see docker-compose.yml) rather than a
// fault -- the row simply doesn't appear.
async function readContainerRuntime() {
	try {
		const Docker = require("dockerode");
		const docker = new Docker({ socketPath: "/var/run/docker.sock" });
		const version = await docker.version();

		// Podman answers the same API and identifies itself in
		// Components, so this reports whichever is actually there
		// rather than assuming Docker.
		const isPodman = (version.Components || []).some((component) =>
			/podman/i.test(component.Name || "")
		);

		return {
			name: isPodman ? "Podman" : "Docker",
			version: version.Version || null
		};
	} catch (error) {
		return null;
	}
}

// Dashboard faces only. Admin, welcome, wizard, About and input faces
// are all infrastructure -- someone asking "how many dashboards do I
// have" means the ones they built, not the machinery serving them.
function countDashboards() {
	try {
		return readFaces().length;
	} catch (error) {
		return null;
	}
}

// Modules and themes together: both are things installed from the
// registry, and splitting them into two numbers says less than one
// number does about how much is set up.
function countInstalledResources() {
	try {
		return listModules().length + themeLoader.listThemes().length;
	} catch (error) {
		return null;
	}
}

// The same question GET /health answers, asked directly rather than
// over HTTP -- the About face is already inside the process.
function isHealthy() {
	try {
		readFaces();
		return true;
	} catch (error) {
		return false;
	}
}

async function readAll() {
	return {
		version: process.env.OMNICORE_VERSION || "dev",
		healthy: isHealthy(),
		dashboards: countDashboards(),
		resources: countInstalledResources(),
		operatingSystem: readOperatingSystem(),
		runtime: await readContainerRuntime()
	};
}

module.exports = {
	readAll,
	readOperatingSystem,
	readContainerRuntime,
	countDashboards,
	countInstalledResources,
	isHealthy
};