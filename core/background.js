// core/background.js
// Runs the modules that keep working between requests.
//
// TWO KINDS OF MODULE
//
// Almost every module is asked, answers, and stops. A display wants a
// tile, OmniCore calls the module's function, the function fetches
// something and returns blocks, and until the next request nothing of it
// is running at all. That's what keeps a dashboard of twenty tiles cheap.
//
// Some things can't work that way. A message stream (ntfy), a mailbox
// that pushes new mail, anything that TELLS you something happened rather
// than waiting to be asked -- those need a connection held open the whole
// time, whether or not a display happens to be looking. That's a
// background module.
//
// A module says it's one in its module.json, outright:
//
//     { "name": "ntfy", "background": true }
//
// and exports two more functions next to its usual one, the same way an
// input-taking module adds `onInput`:
//
//     module.exports = async function (config, richness, omni) { ... };
//     module.exports.start = async function (config, omni) { ... };
//     module.exports.stop = async function (handle) { ... };   // optional
//
// `start` is called once per instance, and whatever it returns is handed
// back to `stop` when that instance is done -- so a module can return its
// timer, its socket, whatever it needs to shut down, without keeping a
// list of its own.
//
// WHEN EACH ONE IS CALLED
//
// This file keeps a list of what's running, one entry per instance, and
// lines it up with the faces on disk whenever they might have changed:
//
//   - OmniCore starts:          every background instance is started
//   - an instance is added:     it's started
//   - its settings change:      stopped, then started with the new ones
//   - it's removed:             it's stopped
//
// Changing an instance's label doesn't restart anything -- only its
// settings, since those are what `start` was given.
//
// WHAT CORE CLEANS UP BY ITSELF
//
// `stop` is optional because Core already tidies up everything it handed
// out. When an instance stops, its `omni.signal` is aborted (so a fetch
// it passed that signal to ends on its own), any shared connection it
// joined is left, and from then on `notify`, `connections.join` and every
// write to `memory` or `storage` is quietly ignored -- so a timer that
// fires one last time can't bring back data the instance's removal just
// deleted. A module only needs `stop` for things it set up entirely by
// itself, like a setInterval.
//
// A RESTART IS STOP, THEN START -- IN THAT ORDER
//
// When settings change, the new run's `start` isn't called until the old
// run's `stop` has finished. Otherwise, for a moment, both would be live
// at once: the old one's timers writing into the same memory the new one
// just set up, or the old one still holding something (a port, a file)
// the new one needs.
//
// A MODULE THAT FAILS TO START
//
// Costs that one instance its background work, logged, and nothing else.
// It isn't retried in a loop -- a module that throws on start will most
// likely throw again -- but it does get another go the next time that
// face changes, or OmniCore restarts.

const { loadModule } = require("./module-loader");
const { readManifest, applyDefaults } = require("./module-config");
const { makeModuleApi, forgetRemovedMemories } = require("./module-api");
const { resolveLocations } = require("./location-service");
const sharedConnections = require("./shared-connections");
const notifications = require("./notifications");

// What's running, keyed by instance id. Each entry:
//
//   faceId       which face the instance is on
//   moduleId     which module it's an instance of
//   signature    its settings when it was started, so a change is noticed
//   controller   aborted when it stops -- that's `omni.signal`
//   memberships  every shared connection it joined, so they can be left
//   moduleFn     the module itself, as it was when this run started --
//                kept so `stop` can always be found, even if the module's
//                folder is mid-update on disk when the time comes
//   handle       whatever `start` returned, for `stop`
//   started      has `start` finished yet?
//   stopped      has it been told to stop?
const running = new Map();

// What went wrong, as words. A module can throw anything at all --
// `undefined`, a string -- and reading `.message` off those would itself
// throw, in the middle of the cleanup meant to recover from them.
function describe(error) {
	return error && error.message ? error.message : String(error);
}

// Modules that said they run in the background but don't export a
// `start`, so the warning is printed once per module rather than on
// every single sync
const warnedAbout = new Set();

// Is this a module that should be running in the background?
//
// Both halves have to agree: module.json says so, AND there's a `start`
// to call. One without the other is a module that's half-written, and is
// treated as an ordinary one rather than guessed at.
function isBackgroundModule(moduleId) {
	if (!readManifest(moduleId).background) {
		return false;
	}

	const moduleFn = loadModule(moduleId);

	if (!moduleFn) {
		// Not installed, or won't load. face-loader shows that on its tile.
		return false;
	}

	if (typeof moduleFn.start !== "function") {
		if (!warnedAbout.has(moduleId)) {
			warnedAbout.add(moduleId);
			console.log(
				`  Module "${moduleId}" says it runs in the background but has no start function`
			);
		}

		return false;
	}

	return true;
}

// The settings an instance would be started with, as one comparable
// string. Run through the module's defaults first, so filling in a field
// with exactly its default value isn't mistaken for a change.
function signatureOf(instance) {
	return JSON.stringify(applyDefaults(instance.module, instance.config));
}

// Call a module's `stop`, if it has one. A `stop` that throws is logged
// and otherwise ignored -- the instance is stopping regardless.
async function callStop(run) {
	const moduleFn = run.moduleFn;

	if (!moduleFn || typeof moduleFn.stop !== "function") {
		return;
	}

	try {
		await moduleFn.stop(run.handle);
	} catch (error) {
		console.log(
			`  Module "${run.moduleId}" failed while stopping: ${describe(error)}`
		);
	}
}

// The `omni` a background run is given: everything the tile function
// gets, scoped to the same instance, plus the three things only a
// background run has any use for.
function backgroundApi(run, instanceId) {
	const base = makeModuleApi(run.faceId, instanceId);

	return {
		...base,

		// The same memory and storage the tile function gets, except that
		// once this run is stopped, writing does nothing. Its instance may
		// have just been removed, its file and memory deleted with it, and
		// a late write from a timer would quietly bring them back.
		memory: {
			read: () => (run.stopped ? {} : base.memory.read()),
			write: (data) => {
				if (!run.stopped) {
					base.memory.write(data);
				}
			}
		},
		storage: {
			read: () => base.storage.read(),
			write: (data) => {
				if (!run.stopped) {
					base.storage.write(data);
				}
			}
		},

		// Aborted the moment this instance stops. Pass it to anything that
		// accepts one -- `fetch(url, { signal: omni.signal })` -- and that
		// thing ends by itself, with no stop code needed.
		signal: run.controller.signal,

		// Show a notification on whichever OmniView is showing this
		// instance's face. Same shape notifications.js documents:
		//
		//   notify({ title, description, priority, link }) -> true if it
		//   was shown or held for later, false if it was dropped
		//
		// `description` may use a small Markdown subset; `link` is
		// { url, title } and shows as a QR code beside the message.
		//
		// Only here, not on the tile function's `omni`. The tile function
		// runs every time a display polls -- every few seconds, forever --
		// so a notification raised from there would be raised again and
		// again for the same thing.
		notify(message) {
			if (run.stopped) {
				return false;
			}

			return notifications.notify(run.faceId, message);
		},

		// Join a connection shared with every other instance of this
		// module that wants the same server. See core/shared-connections.js.
		//
		//   connections.join({ key, interest, open, onEvent }) -> { leave }
		//
		// No need to leave on stop -- Core does that.
		connections: {
			join(options) {
				// Joining after being told to stop would open a connection
				// nobody is going to close. Hand back something harmless.
				if (run.stopped) {
					return { leave() {} };
				}

				const membership = sharedConnections.join(run.moduleId, options);
				run.memberships.add(membership);

				return {
					leave() {
						run.memberships.delete(membership);
						membership.leave();
					}
				};
			}
		}
	};
}

// Start one instance's background work.
//
// `after` is the previous run's stop, when this is a restart. The new run
// goes on the list straight away -- so nothing else can mistake this
// instance for one that isn't running -- but its `start` waits for that
// stop to finish first.
function startInstance(faceId, instance, signature, after) {
	const run = {
		faceId: faceId,
		moduleId: instance.module,
		signature: signature,
		controller: new AbortController(),
		memberships: new Set(),
		moduleFn: null,
		handle: undefined,
		started: false,
		stopped: false
	};

	running.set(instance.id, run);

	// Resolves once `start` has finished, whichever way it went. Never
	// rejects -- a failure is handled in here, not passed on.
	return (async () => {
		if (after) {
			await after;
		}

		// Told to stop before it ever got going -- another save came in
		// while the old run was stopping. Nothing was started, so there's
		// nothing to undo.
		if (run.stopped) {
			return;
		}

		try {
			// Exactly what the tile function gets: defaults filled in, and
			// any location turned into real coordinates
			const config = applyDefaults(instance.module, instance.config);
			await resolveLocations(instance.module, config);

			run.moduleFn = loadModule(instance.module);
			run.handle = await run.moduleFn.start(
				config,
				backgroundApi(run, instance.id)
			);
			run.started = true;

			// Told to stop while it was still starting (removed straight
			// after being added, say). Now that `stop` has a handle to
			// work with, stop it.
			if (run.stopped) {
				await callStop(run);
			}
		} catch (error) {
			console.log(
				`  Module "${instance.module}" failed to start in the background: ${describe(error)}`
			);

			// Undo whatever it managed before failing, and take it off the
			// list so the next sync gives it another go
			run.stopped = true;
			run.controller.abort();
			releaseMemberships(run);

			if (running.get(instance.id) === run) {
				running.delete(instance.id);
			}
		}
	})();
}

function releaseMemberships(run) {
	for (const membership of run.memberships) {
		membership.leave();
	}

	run.memberships.clear();
}

// Stop one instance's background work.
async function stopInstance(instanceId) {
	const run = running.get(instanceId);

	if (!run) {
		return;
	}

	running.delete(instanceId);
	run.stopped = true;

	// Core's own cleanup first, so even a module with no `stop` at all is
	// properly stopped
	run.controller.abort();
	releaseMemberships(run);

	// If `start` is still running, there's no handle yet. startInstance
	// notices `stopped` once it finishes and calls `stop` itself then.
	if (run.started) {
		await callStop(run);
	}
}

// Line up what's running with what this face holds right now.
//
// Safe to call as often as anyone likes: an instance already running
// with the same settings is left alone. Called on boot, and after
// anything that changes a face's instances. Never rejects.
async function syncFace(face) {
	if (!face) {
		return;
	}

	const work = [];

	// What should be running on this face, and with which settings
	const wanted = new Map();

	for (const instance of face.instances) {
		if (isBackgroundModule(instance.module)) {
			wanted.set(instance.id, instance);
		}
	}

	// Anything running on this face that shouldn't be any more: removed,
	// or its module no longer runs in the background
	for (const [instanceId, run] of running) {
		if (run.faceId === face.id && !wanted.has(instanceId)) {
			work.push(stopInstance(instanceId));
		}
	}

	// Anything that should be running and isn't, or is running with
	// settings that have since changed
	for (const [instanceId, instance] of wanted) {
		const signature = signatureOf(instance);
		const current = running.get(instanceId);

		if (current && current.signature === signature) {
			continue;
		}

		// The swap on the list of what's running happens all at once, here,
		// with no waiting in between: the old run comes off and the new one
		// goes on before anything else gets a turn. With a wait in the
		// middle, a second save arriving during it would find nothing
		// running, start its own copy, and then have it silently replaced
		// by this one -- leaving one running that nothing would ever stop.
		//
		// The waiting happens inside the new run instead: its `start` is
		// held back until the old run's `stop` has finished. See the top
		// of this file.
		const stopping = current ? stopInstance(instanceId) : null;

		if (stopping) {
			work.push(stopping);
		}

		work.push(startInstance(face.id, instance, signature, stopping));
	}

	// The in-memory scratch space of any instance no longer on this face
	// goes too, background module or not -- nothing an instance kept
	// should outlive it
	forgetRemovedMemories(
		face.id,
		face.instances.map((instance) => instance.id)
	);

	await Promise.all(work);
}

// Restart every running instance of one module, so each picks up new code.
//
// Called after an update has replaced the module on disk (and Node has
// been told to forget the old copy, see module-loader.js). Each instance
// goes through the same stop-then-start a settings change gets, so the
// old code's `stop` runs before the new code's `start`. Faces that hold
// the module but have nothing running yet are synced too: an update can
// be what turns an ordinary module into a background one.
async function restartModule(moduleId) {
	for (const run of running.values()) {
		if (run.moduleId === moduleId) {
			// Matches no instance's settings, so syncFace restarts it
			run.signature = null;
		}
	}

	// Required here rather than at the top: nothing else in this file needs
	// the face list, and it keeps this file from depending on face storage
	// just for this one job.
	const { readFaces } = require("./face-store");

	const faces = readFaces().filter((face) =>
		face.instances.some((instance) => instance.module === moduleId)
	);

	await Promise.all(faces.map(syncFace));
}

// What's running right now, for tests and for anyone curious
function list() {
	return [...running.entries()].map(([instanceId, run]) => ({
		instanceId: instanceId,
		faceId: run.faceId,
		moduleId: run.moduleId,
		started: run.started
	}));
}

module.exports = { syncFace, restartModule, list };