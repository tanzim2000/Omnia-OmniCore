// docs/ui-elements.js
// The words behind the "Default UI" page of the docs site: a name, a
// description and a working sample for every element in
// core/ui-theme.js.
//
// Why this is a separate file: ui-theme.js is the stylesheet every page
// OmniCore draws depends on, and it should stay a stylesheet. The things
// a person reads about each element -- what it's for, when to use it,
// what to watch out for -- live here instead, and the docs site puts the
// two together when it's built (scripts/build-docs.js).
//
// What keeps this file honest: test/docs-site.test.js reads every class
// out of the real stylesheet and fails if one isn't named in some
// entry's `sel` below, or if an entry names a class the stylesheet no
// longer has. So adding an element to ui-theme.js means adding it here
// too, in the same commit, or the tests go red.
//
// Nothing in this file is loaded by OmniCore itself. It's only read when
// the docs site is built, so it never reaches the server or the image.
//
// ---------------------------------------------------------------------
// The shape of an element entry
//
//   id      short name, used as the page anchor (#glass). Unique.
//   title   what a person calls it ("Glass button")
//   sel     the classes it's made of, written for a person to read
//           (".dock > button (+ .danger)"). Every class written here
//           counts as "described" for the test above.
//   desc    one paragraph: what it is and when to use it. HTML allowed,
//           so write < and > as &lt; and &gt; when you mean the
//           characters themselves.
//   demo    HTML for the live sample. It's drawn with the real
//           stylesheet, so it looks exactly like the real thing.
//   code    the markup someone would copy. Plain text: shown as written.
//   note    (optional) a catch worth knowing. HTML allowed.
//   stage   (optional) a height in pixels. For an element that's normally
//           pinned to the screen (position: fixed), such as the floating
//           buttons or a pop-up: the sample gets a box of this height and
//           stays inside it instead of jumping to the window's corner.
// ---------------------------------------------------------------------

// What each colour in PALETTES is for. The values themselves are read
// from ui-theme.js when the site is built; only the explanation is here.
// The test checks every colour has one, and no explanation is left over
// for a colour that's been removed.
const paletteNotes = {
	bg: "Page background.",
	fg: "Main text colour.",
	fgMuted: "Quieter text: labels, hints, secondary info.",
	glassBg: "Fill of glass buttons, inputs and the dock.",
	glassBgHover: "Glass fill on hover or focus, and the active tab.",
	glassBorder: "Border of glass buttons, inputs, the dock and pop-ups.",
	glassSheen: "Thin highlight along a glass button's top edge (the bevel).",
	glassSheenStrong: "The brighter sheen across the upper half of glass buttons.",
	glow: "Soft halo colour at rest.",
	glowStrong: "Halo on hover or focus; also the keyboard focus ring.",
	ambientA: "Faint blob behind the page (top-left), so the blur has something to blur.",
	ambientB: "Faint blob behind the page (bottom-right).",
	segmentBg: "Fill of every segment, the tabs track and floating buttons.",
	segmentBorder: "Border of segments, lists and tabs.",
	flash: "What a floating button flashes when tapped.",
	scrollThumb: "Scrollbar thumb inside lists.",
	border: "A quieter border for grouping content (option rows, the grey button).",
	hoverSubtle: "Very light hover wash (option rows, badge fill).",
	inputBg: "Fill of the stepper's number and search results.",
	wellBg: "A recessed well, such as the corner map. Lighter on dark, darker on light.",
	danger: "Red for errors and destructive actions (Remove).",
	dangerText: "Text on a danger background.",
	dangerBg: "Error message background.",
	dangerBorder: "Error message border.",
	successBg: "Success message background.",
	successBorder: "Success message border.",
	success: "Bright green: good status text and a switch that's on.",
	successHover: "Darker green, for hover.",
	successText: "Text on a success background.",
	successButton: "Fill of the green button. A gradient in dark, flat in light.",
	successButtonHover: "Green button on hover.",
	successButtonBorder: "Green button border.",
	successButtonText: "Green button label.",
	successButtonShadow: "Green button shadow (dark: a bevel; light: none).",
	disabled: "Disabled fill; also the bottom of the grey button.",
	disabledText: "Disabled text; also the top of the grey button."
};

// How the colour table is split into groups on the page. A colour that's
// in PALETTES but missing from every group still shows, under "Other".
const paletteGroups = [
	["Surface and text", ["bg", "fg", "fgMuted", "ambientA", "ambientB"]],
	["Glass (buttons, inputs, dock)", ["glassBg", "glassBgHover", "glassBorder", "glassSheen", "glassSheenStrong", "glow", "glowStrong"]],
	["Segments and structure", ["segmentBg", "segmentBorder", "border", "hoverSubtle", "inputBg", "wellBg", "flash", "scrollThumb"]],
	["Danger", ["danger", "dangerText", "dangerBg", "dangerBorder"]],
	["Success and the green button", ["success", "successHover", "successText", "successBg", "successBorder", "successButton", "successButtonHover", "successButtonBorder", "successButtonText", "successButtonShadow"]],
	["Disabled", ["disabled", "disabledText"]]
];

// The sun and moon drawn inside the light/dark switch, shared by its
// sample below
const SUN_AND_MOON =
	'<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>' +
	'<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';

// A password box with its Show button, as passwordField() writes it.
// Shared by two samples below.
function passwordSample(attributes) {
	return `<div class="password-field"><input type="password" ${attributes}><button type="button" class="password-toggle" data-password-toggle aria-pressed="false" aria-label="Show password">Show</button></div>`;
}

// ---------------------------------------------------------------------
// The elements, in the order they appear on the page
// ---------------------------------------------------------------------
const sections = [
	{
		id: "foundations",
		title: "Foundations",
		intro: "What every other element is built from.",
		entries: [
			{
				id: "variables",
				title: "Global variables",
				sel: ":root",
				desc: "Four layout variables set on every page, besides the colours above. They're the knobs Settings turns (font and text size) plus the two that shape every box.",
				demo: `<table class="plain">
<tr><td><code>--font</code></td><td>The font stack. The system font until a Google font is installed, then <code>"Name", system-ui, …</code>.</td></tr>
<tr><td><code>--font-size</code></td><td>Base size in px (16 unless changed in Settings). Almost everything is sized in <code>em</code>, so this scales the whole UI.</td></tr>
<tr><td><code>--radius</code></td><td>0.75em. The corners of segments, lists, tabs and glass buttons.</td></tr>
<tr><td><code>--segment-blur</code></td><td><code>none</code>. Set it to something like <code>blur(0.75em)</code> to turn every segment into frosted glass.</td></tr>
</table>`,
				code: ":root {\n\t--font: system-ui, …;\n\t--font-size: 16px;\n\t--radius: 0.75em;\n\t--segment-blur: none;\n}",
				note: "With --segment-blur turned on, a blurred box becomes the frame for anything inside it with position: fixed, so a pop-up (.modal-backdrop) has to sit outside every segment."
			},
			{
				id: "body",
				title: "Page body and its background",
				sel: "body",
				desc: "The page colour, with two very faint round blobs (--ambient-a and --ambient-b) fixed behind everything. They're there so frosted glass has something to blur: blurring a flat colour just gives the same flat colour.",
				demo: `<p class="muted" style="margin:0">The soft glow behind this whole page is it.</p>`,
				code: "body { background: var(--bg); color: var(--fg); font-family: var(--font); … }",
				note: "Two rules apply by themselves: a page with a back button in the top-left corner starts below it, and one with the button bottom-right ends above it, so the button never covers anything."
			},
			{
				id: "type",
				title: "Text styles",
				sel: "h1 · .lede · label · .help · .hint · .empty · .muted",
				desc: "The few text styles there are. <b>h1</b> is the page title (light weight). <b>.lede</b> is the line under it. <b>label</b> sits above a field and <b>.help</b> under it. <b>.hint</b> is small grey text on its own line, <b>.empty</b> the “nothing here yet” message, and <b>.muted</b> any text in the quiet colour.",
				demo: `<h1>Page title</h1>
<p class="lede">A lede: one quiet line saying what the page is for.</p>
<div class="field" style="margin-top:1em"><label>Label above a field</label><input type="text" placeholder="A field"><div class="help">.help: a small note under the field.</div></div>
<span class="hint">.hint: small grey text on its own line.</span>
<p class="empty">.empty: nothing to show yet.</p>
<p class="muted" style="margin-bottom:0">.muted: any text in the quiet colour.</p>`,
				code: '<h1>Page title</h1>\n<p class="lede">One quiet line.</p>\n<div class="field">\n\t<label>Label</label>\n\t<input type="text">\n\t<div class="help">A note.</div>\n</div>'
			}
		]
	},
	{
		id: "buttons",
		title: "Buttons",
		intro: "Everything clickable that looks like a button.",
		entries: [
			{
				id: "glass",
				title: "Glass button",
				sel: ".glass",
				desc: "The main button. A see-through fill, a bevelled edge, a light sheen over its top half, and a halo when pointed at or reached with the keyboard. It shrinks a little when pressed. Works on a &lt;button&gt; or an &lt;a&gt;.",
				demo: '<button class="glass">Save</button> <button class="glass" disabled>Disabled</button>',
				code: '<button class="glass">Save</button>\n<button class="glass" disabled>Saving…</button>',
				note: "A disabled one is faded, with no glow and no press. Disable it whenever a click would do nothing (Update now without Docker, Save while saving), or it reads as broken."
			},
			{
				id: "glossy",
				title: "Coloured buttons",
				sel: ".btn-glossy .btn-glossy-green / .btn-glossy-neutral",
				desc: "For the few moments that should stand out: green for the safe or finished choice (“Installed”, “Go back”), grey for the second choice. Smaller and squarer than a glass button. Always pair .btn-glossy with one colour class. The green has its own colours (--success-button-*), so it can be calmer than the green of good status text.",
				demo: '<button class="btn-glossy btn-glossy-green">Installed</button> <button class="btn-glossy btn-glossy-neutral">Cancel</button> <button class="btn-glossy btn-glossy-green" disabled>Disabled</button>',
				code: '<button class="btn-glossy btn-glossy-green">Installed</button>\n<button class="btn-glossy btn-glossy-neutral">Cancel</button>',
				note: "In dark mode they're glossy, with a bevel. In light mode they're flat: white label, no shadow."
			},
			{
				id: "dock",
				title: "Capsule (dock)",
				sel: ".dock > button (+ .danger)",
				desc: "One continuous capsule holding two or three actions, with a thin line between them: the wizard's Cancel | Back | Next, a module's Save | Remove. It sits in the page, not floating over it. Each section glows like a glass button. The capsule keeps the same width however many sections it has (26em upright, 30em on a wide screen), and nothing in it is ever marked as chosen.",
				demo: '<div class="center-row"><div class="dock"><button type="button">Save</button><button type="button" class="danger">Remove</button></div></div>',
				code: '<div class="dock">\n\t<button type="button">Save</button>\n\t<button type="button" class="danger">Remove</button>\n</div>',
				note: ".danger gives a section a red label and a red glow: a warning, not the safeguard. The action should still ask before doing anything. The capsule doesn't clip its contents on purpose, since that would clip the glow too."
			},
			{
				id: "dock-disabled",
				title: "Capsule with a section turned off",
				sel: ".dock button:disabled",
				desc: "A section that can't be pressed right now (Back on the first step, Save while saving): faded, no glow.",
				demo: '<div class="center-row"><div class="dock"><button type="button" disabled>Back</button><button type="button">Next</button></div></div>',
				code: '<div class="dock">\n\t<button type="button" disabled>Back</button>\n\t<button type="button">Next</button>\n</div>'
			},
			{
				id: "floating",
				title: "Floating round button",
				sel: ".floating + .bottom-right / .top-left (+ .flash)",
				desc: "A flat round button pinned to a corner of the screen: the Back button (&#8592;). It's deliberately not glossy, and it flashes when tapped (.flash, or while pressed) rather than glowing. Which corner is a setting. Bottom-left is never offered: that's where the welcome face's timer lives.",
				stage: 150,
				demo: '<button class="floating top-left" aria-label="Back">&#8592;</button><button class="floating bottom-right" aria-label="Back">&#8592;</button><span class="muted stage-caption">top-left and bottom-right</span>',
				code: '<button class="floating bottom-right" aria-label="Back"\n\tonclick="location.href=\'/\'">&#8592;</button>\n\n// or let the helper write it, in the corner from Settings:\nbackButton("/")',
				note: "Here it's kept inside its box. On a real page it's pinned to the window's corner."
			},
			{
				id: "mode-switch",
				title: "Light / dark switch",
				sel: ".floating.top-right.mode-switch (.icon-sun, .icon-moon)",
				desc: "A smaller round floating button, top-right, and only on the sign-in and setup page: everywhere else the choice is in Settings → Appearance. It shows where it would take you: a sun on a dark page, a moon on a light one. Both icons are always in the markup; the stylesheet shows the right one.",
				stage: 110,
				demo: `<div class="floating top-right mode-switch" style="cursor:default">${SUN_AND_MOON}</div>`,
				code: "modeSwitch()\t// writes the button with both icons\n// MODE_SWITCH_SCRIPT makes the click work",
				note: "Switch this site between Dark and Light at the top of the page to watch the icon change."
			},
			{
				id: "password-toggle",
				title: "Show / Hide button",
				sel: ".password-toggle (inside .password-field)",
				desc: "A borderless text button inside the right end of a password box. It switches the box between hidden and plain text so a typo can be checked. Nothing leaves the page because of it.",
				demo: passwordSample('value="hunter2" aria-label="Sample password"'),
				code: 'passwordField(\'<input type="password" id="pw" autocomplete="current-password">\')',
				note: "PASSWORD_TOGGLE_SCRIPT makes it work: one listener for the whole page. It works here too."
			},
			{
				id: "modal-close",
				title: "Pop-up close button",
				sel: ".modal-close",
				desc: "The ✕ in a pop-up's header. Not a glass button on purpose: closing is the least important thing on the panel, and a glow would pull the eye away from what was opened.",
				demo: '<button class="modal-close" aria-label="Close">&#10005;</button>',
				code: '<button class="modal-close" aria-label="Close">&#10005;</button>'
			}
		]
	},
	{
		id: "containers",
		title: "Boxes and lists",
		intro: "The boxes and scrolling lists that pages are built from.",
		entries: [
			{
				id: "segment",
				title: "Segment",
				sel: ".segment",
				desc: "The box. Every page is built from these: each tile in Settings, the wizard's halves, a face in the welcome list, a Marketplace listing. It replaced three near-copies (.card and two kinds of .tile). Nothing happens when it's pointed at.",
				demo: '<div class="segment">A plain segment: a container.</div>',
				code: '<div class="segment">…</div>'
			},
			{
				id: "segment-clickable",
				title: "Clickable segment",
				sel: ".segment.clickable",
				desc: "A segment where the whole box is a link or a button. In dark mode it glows when pointed at; in light mode it lifts slightly instead, because a glow disappears against a pale page.",
				demo: '<div class="segment clickable" tabindex="0">Point at me: a clickable segment.</div>',
				code: '<a class="segment clickable" href="/faces/001">…</a>'
			},
			{
				id: "list",
				title: "Scrolling list",
				sel: ".list",
				desc: "A column that scrolls inside itself (up to 60% of the screen's height) so the page doesn't move. Rows keep their full height and the list scrolls, instead of every row getting squashed. A slim scrollbar.",
				demo: '<div class="list" style="max-height:11em"><div class="segment">Row 1</div><div class="segment">Row 2</div><div class="segment">Row 3</div><div class="segment">Row 4</div><div class="segment">Row 5</div></div>',
				code: '<div class="list">\n\t<div class="segment">Row</div>\n\t…\n</div>'
			},
			{
				id: "font-row",
				title: "One-line row",
				sel: ".font-row",
				desc: "A clickable segment used as a single line in a list: a name on the left and a small label pinned to the right (a .hint). The font picker uses it; it suits any long list that reads better one line per entry.",
				demo: '<div class="list"><div class="segment clickable font-row"><span>Bitcount Ink</span><span class="hint">display</span></div><div class="segment clickable font-row"><span>Pixelify Sans</span><span class="hint">sans-serif</span></div></div>',
				code: '<div class="segment clickable font-row">\n\t<span>Name</span><span class="hint">label</span>\n</div>'
			},
			{
				id: "list-fill",
				title: "Filling list",
				sel: ".list-fill",
				desc: "Like the scrolling list, but it grows to whatever height its parent gives it, and only scrolls once it really runs out of room. For a segment stretched to fill the screen. The parent has to be a flex column with a height.",
				demo: '<div style="display:flex;flex-direction:column;height:11em"><div class="list-fill"><div class="segment">Row 1</div><div class="segment">Row 2</div><div class="segment">Row 3</div><div class="segment">Row 4</div><div class="segment">Row 5</div></div></div>',
				code: '<div style="display:flex; flex-direction:column; height:…">\n\t<div class="list-fill">…</div>\n</div>'
			},
			{
				id: "toolbar",
				title: "Toolbar",
				sel: ".toolbar (+ .toolbar-note)",
				desc: "One row of controls over a list: a search box that takes whatever room is left, a tabs switch, a quiet count. On a narrow screen it wraps instead of squeezing the search box. It's only the layout: put it on a segment to get the box.",
				demo: '<div class="segment toolbar"><input type="text" placeholder="Search" aria-label="Search"><div class="tabs"><button class="tab-btn active">Modules</button><button class="tab-btn">Themes</button></div><span class="toolbar-note">9 items</span></div>',
				code: '<div class="segment toolbar">\n\t<input type="text" placeholder="Search">\n\t<div class="tabs">…</div>\n\t<span class="toolbar-note">9 items</span>\n</div>'
			},
			{
				id: "modal",
				title: "Pop-up (modal)",
				sel: ".modal-backdrop > .modal (.modal-head)",
				desc: "A centred panel over a dimmed, blurred screen, for a control that needs more room than its segment has (the font picker's results, the location search). The backdrop covers the whole screen; give it the hidden attribute to hide it. At most 26em wide and 80% of the screen tall.",
				stage: 300,
				demo: '<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>Choose a font</h2><button class="modal-close" aria-label="Close">&#10005;</button></div><input type="text" placeholder="Search" aria-label="Search fonts"><div class="list"><div class="segment clickable font-row"><span>Adamina</span><span class="hint">serif</span></div></div></div></div>',
				code: '<div class="modal-backdrop" hidden>\n\t<div class="modal">\n\t\t<div class="modal-head">\n\t\t\t<h2>Title</h2>\n\t\t\t<button class="modal-close">&#10005;</button>\n\t\t</div>\n\t\t…\n\t</div>\n</div>',
				note: "It has to sit outside every segment (see --segment-blur above). Here it's kept inside its box; normally it covers the whole window."
			}
		]
	},
	{
		id: "choices",
		title: "Choices and switches",
		intro: "Ways of picking something.",
		entries: [
			{
				id: "tabs",
				title: "Tabs",
				sel: ".tabs > .tab-btn (+ .active)",
				desc: "A pill of named options, one of them chosen. Use it when the options are named things (Dark / Light / Device, Modules / Themes, the corner names), not a plain on and off. Often each option shows different settings underneath.",
				demo: '<div class="tabs" data-demo-tabs><button class="tab-btn active">Dark</button><button class="tab-btn">Light</button><button class="tab-btn">Device</button></div>',
				code: '<div class="tabs">\n\t<button class="tab-btn active">Dark</button>\n\t<button class="tab-btn">Light</button>\n</div>',
				note: "Clicking works here. On a real page, the page's own script moves .active."
			},
			{
				id: "switch",
				title: "Switch",
				sel: ".switch (.switch-track, .switch-knob)",
				desc: "A sliding knob for a plain yes-or-no preference with nothing else attached to it. Green when on. Different from tabs on purpose: a switch is on or off; tabs are a choice between named things.",
				demo: '<label class="switch"><input type="checkbox" checked><span class="switch-track"><span class="switch-knob"></span></span><span>On</span></label> &nbsp; <label class="switch"><input type="checkbox"><span class="switch-track"><span class="switch-knob"></span></span><span>Off</span></label>',
				code: '<label class="switch">\n\t<input type="checkbox" checked>\n\t<span class="switch-track"><span class="switch-knob"></span></span>\n\t<span>Enabled</span>\n</label>'
			},
			{
				id: "stepper",
				title: "Number stepper",
				sel: ".stepper",
				desc: "Minus, a number, plus: for a small number set one step at a time (text size). The two buttons are small glass buttons, and the browser's own little arrows are hidden since the buttons already do that job. Not a slider: a slider is for dragging through a smooth range.",
				demo: '<div class="stepper" data-demo-stepper><button class="glass" type="button" data-step="-1" aria-label="Smaller">&minus;</button><input type="number" value="16" min="10" max="30" aria-label="Text size"><button class="glass" type="button" data-step="1" aria-label="Bigger">+</button></div>',
				code: '<div class="stepper">\n\t<button class="glass">&minus;</button>\n\t<input type="number" value="16">\n\t<button class="glass">+</button>\n</div>'
			},
			{
				id: "widget-picker",
				title: "Widget type picker",
				sel: ".widget-picker > .widget-choice (+ .active, .widget-off)",
				desc: "A grid with one button per widget type a module offers (Month View, Agenda View…), at the top of its settings. Shaped like the option rows so it reads as part of the same form. Only shown when a module actually offers a choice.",
				demo: '<div class="widget-picker"><button class="widget-choice active" type="button"><strong>Month View</strong><small>A full month grid</small></button><button class="widget-choice" type="button"><strong>Agenda View</strong><small>A list of upcoming events</small></button></div>',
				code: '<div class="widget-picker">\n\t<button class="widget-choice active">\n\t\t<strong>Month View</strong><small>…</small>\n\t</button>\n</div>',
				note: ".widget-off hides a setting that belongs to a widget type other than the one picked. It's a class rather than a style, so it can't fight with a setting hidden for another reason (showWhen)."
			},
			{
				id: "option",
				title: "Option row",
				sel: ".option",
				desc: "A bordered row holding a radio button or a checkbox and its words; the whole row can be clicked. A stack of them is a pick-one (radios) or pick-several (checkboxes).",
				demo: '<label class="option"><input type="radio" name="demo-option" checked> Automatic</label><label class="option" style="margin-bottom:0"><input type="radio" name="demo-option"> Set it myself</label>',
				code: '<label class="option"><input type="radio" name="o"> Automatic</label>'
			}
		]
	},
	{
		id: "forms",
		title: "Form fields",
		intro: "Boxes to type into, and the pieces around them.",
		entries: [
			{
				id: "field",
				title: "Field",
				sel: ".field",
				desc: "A label, the box, and an optional note under it, with space below. The basic unit of every form.",
				demo: '<div class="field" style="margin:0"><label>Server name</label><input type="text" value="Omnia"><div class="help">Shown in the browser tab.</div></div>',
				code: '<div class="field">\n\t<label>Server name</label>\n\t<input type="text">\n\t<div class="help">A note.</div>\n</div>'
			},
			{
				id: "inputs",
				title: "Text, address, number, password and drop-down",
				sel: "input[type=text | url | number | password], select",
				desc: "All five look the same: full width, glass fill, a thin border, rounded corners. A drop-down's list is given the page's colours too; left alone, the browser draws it white on white in dark mode.",
				demo: '<div class="field"><input type="text" placeholder="Text" aria-label="Text"></div><div class="field"><input type="url" placeholder="https://address" aria-label="Address"></div><div class="field"><input type="number" value="42" aria-label="Number"></div><div class="field"><input type="password" value="secret" aria-label="Password"></div><select aria-label="Drop-down"><option>Choice A</option><option>Choice B</option></select>',
				code: '<input type="text">\n<input type="url">\n<input type="number">\n<input type="password">\n<select><option>…</option></select>'
			},
			{
				id: "password-field",
				title: "Password box",
				sel: ".password-field",
				desc: "Wraps a password box and puts the Show / Hide button inside its right end, with room kept on the right so typing never runs under the button.",
				demo: passwordSample('placeholder="Password" aria-label="Password"'),
				code: 'passwordField(\'<input type="password" id="pw">\')'
			},
			{
				id: "checkbox-color",
				title: "Checkbox and colour picker",
				sel: "input[type=checkbox], input[type=color]",
				desc: "The checkbox is a plain 18px box (the switch is the nicer on/off). The colour picker is full width and 46px tall, with the glass fill.",
				demo: '<label style="display:flex;gap:8px;align-items:center;margin-bottom:1em"><input type="checkbox" checked> A checkbox</label><input type="color" value="#4a90e2" aria-label="Colour">',
				code: '<input type="checkbox">\n<input type="color" value="#4a90e2">'
			},
			{
				id: "search",
				title: "Search row and results",
				sel: ".search-row · .result",
				desc: "A box with a button beside it (the box takes the room), and under it a stack of full-width results to pick from. The location search uses it.",
				demo: '<div class="search-row"><input type="text" placeholder="Search a place" aria-label="Search a place"><button class="glass" type="button">Search</button></div><button class="result" type="button">Regina, Saskatchewan</button><button class="result" type="button">Dhaka, Bangladesh</button>',
				code: '<div class="search-row">\n\t<input type="text"><button class="glass">Search</button>\n</div>\n<button class="result">A result</button>'
			}
		]
	},
	{
		id: "feedback",
		title: "Status and labels",
		intro: "Small pieces that say something.",
		entries: [
			{
				id: "status",
				title: "Status message",
				sel: ".status (+ .good / .bad)",
				desc: "One line of feedback under an action (“Saved.”, “Couldn't save.”): green with .good, red with .bad. An empty one takes no room at all, so it can sit on the page waiting until there's something to say.",
				demo: '<p class="status good">Saved.</p><p class="status bad">Couldn\'t save: that port is taken.</p><p class="status"></p><span class="muted">(an empty one is there too, taking no room)</span>',
				code: '<p class="status" id="status"></p>\n\nstatus.textContent = "Saved.";\nstatus.className = "status good";'
			},
			{
				id: "badge",
				title: "Badge",
				sel: ".badge",
				desc: "A small outlined label next to a word, such as “dev” after a development build's version. It says something about its neighbour; it isn't a button and doesn't react.",
				demo: '<span style="font-size:1.4em">1.19.4 <span class="badge">dev</span></span>',
				code: '1.19.4 <span class="badge">dev</span>\n\nversionHtml()\t// writes this for you'
			}
		]
	}
];

// The functions and scripts ui-theme.js hands to the pages that use it
const helpers = [
	["uiStyles({ forceMode })", "The whole stylesheet as text, for a page's <style> tag. forceMode \"light\" or \"dark\" wins; otherwise this browser's choice from its cookie; otherwise both, and the device decides."],
	["backButton(href)", "The floating Back button, in the corner chosen in Settings. Nothing at all when href is empty: the welcome face, input faces and the wizard have nowhere to go back to."],
	["modeSwitch()", "The sign-in page's round sun/moon button, with both icons."],
	["passwordField(inputHtml)", "Wraps a password box with its Show / Hide button."],
	["versionHtml()", "The version as a page shows it: “1.19.4”, with a dev badge after it on a development build."],
	["fontStack(settings) · fontFace(settings)", "The font list for CSS, and the @font-face rule for a downloaded font (served at /ui-font.woff2?v=…). Nothing for the system font."],
	["UI_MODE_SCRIPT", "Gives the page setUiMode(mode): saves or forgets the omnicore_ui_mode cookie and reloads. Used by the Appearance tile and the sign-in switch."],
	["MODE_SWITCH_SCRIPT", "Makes the sign-in switch work: it flips to whichever mode isn't showing."],
	["PASSWORD_TOGGLE_SCRIPT", "One listener for the whole page that makes every Show / Hide button work."],
	["rememberUiMode · uiModeFromRequest · currentUiMode", "Server side: read the cookie (only exactly \"light\" or \"dark\" counts) and hand it to uiStyles() for the request being answered."],
	["PALETTES · SYSTEM_FONT · UI_MODE_COOKIE", "The two colour tables, the system font list, and the cookie's name."]
];

// Things people look for in ui-theme.js that are really somewhere else
const elsewhere = [
	[".page-dock", "Centres the Save | Remove capsule on a module's page. In core/admin-face.js; the capsule itself is .dock, from ui-theme.js."],
	[".mode-screen-split · .narrow-previews", "The layout of the Appearance tile. In core/admin-face.js."],
	["The Settings grid and its tiles", "Page layout in core/admin-face.js, built out of segments."],
	["The wizard's layout", "core/wizard-face.js. It uses .dock, .segment and .field from here."],
	["Dashboards and notifications", "Not the Default UI at all. A dashboard face belongs to its theme; notifications are drawn by core/notifications.js."]
];

module.exports = { paletteNotes, paletteGroups, sections, helpers, elsewhere };
