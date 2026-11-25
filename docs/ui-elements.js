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
//   base    (optional) the id of the entry this one builds on, when it's
//           that element plus a modifier class (.glass.small builds on
//           .glass). Shown on the page as "Builds on ...", so the family
//           tree can be read; the test checks the id is real.
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
	bg: "Page background: the Default, black (#000000) with white text and Beige Cream (#eedec5) with black text.",
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
				desc: "The layout variables set on every page, besides the colours above: the knobs Settings turns (font, text size, the glass and the picture behind the page) plus the ones that shape every box.",
				demo: `<table class="plain">
<tr><td><code>--font</code></td><td>The font stack. The system font until a Google font is installed, then <code>"Name", system-ui, …</code>.</td></tr>
<tr><td><code>--font-size</code></td><td>Base size in px (16 unless changed in Settings). Almost everything is sized in <code>em</code>, so this scales the whole UI.</td></tr>
<tr><td><code>--radius</code></td><td>0.75em. The corners of segments, lists, tabs and glass buttons.</td></tr>
<tr><td><code>--segment-blur</code></td><td>Frosted glass, on since v2: <code>blur(var(--glass-blur)) saturate(var(--glass-saturate))</code>. Every segment blurs what's behind it.</td></tr>
<tr><td><code>--glass-blur</code></td><td>How much, in px: 20 unless changed on Settings' Appearance tab (0 to 40).</td></tr>
<tr><td><code>--glass-saturate</code></td><td>1, or 1.4 over a picture, so the colour showing through the glass isn't washed out.</td></tr>
<tr><td><code>--glass-tint</code></td><td>A colour laid over every segment's fill: the tint (0 to 100%) with the Dim's darkness added, as one colour. <code>transparent</code> with neither. The tint is a colour picked, or the background's own: Dominant (the colour covering most of it) or Vibrant (its most eye-catching).</td></tr>
<tr><td><code>--segment-edge</code></td><td>The thin light line along a segment's top edge. Transparent with the plain background, there over a picture.</td></tr>
<tr><td><code>--backdrop-brightness</code></td><td>The picture's brightness, 0.5 to 1.5 (Picture brightness, -50% to +50%; 1 is Original).</td></tr>
<tr><td><code>--on-picture-fg</code></td><td>The colour of text drawn straight on a picture or a colour, with no glass under it (a page's title): white or black by the background itself, never the font colour. Only with a picture or a colour.</td></tr>
</table>`,
				code: ":root {\n\t--font: system-ui, …;\n\t--font-size: 16px;\n\t--radius: 0.75em;\n\t--segment-blur: blur(var(--glass-blur)) saturate(var(--glass-saturate));\n\t--glass-blur: 20px;\n\t--glass-tint: transparent;\n}",
				note: "A blurred box becomes the frame for anything inside it with position: fixed, so a pop-up (.modal-backdrop) has to sit outside every segment."
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
				id: "see-through",
				title: "Page in a frame",
				base: "body",
				sel: "html.see-through",
				desc: "A page shown in a frame over the takeover (Manual Setup): no background of its own, so the takeover's glass shows through, and a little room at its edges so a glow or a focus ring isn't cut off. Its colour scheme is dark, the same as the frame's, because a browser paints a frame solid when the two differ.",
				demo: `<div style="padding:1em;border-radius:0.75em;background:linear-gradient(135deg,#3a6073,#16222a)"><p class="muted" style="margin:0;color:#fff">What's behind the frame shows through it.</p></div>`,
				code: '<html class="see-through">\n\t<head>${styleTag(uiStyles({ forceSet: "dark" }))}</head>\n\t<body>…</body>\n</html>'
			},
			{
				id: "backdrop",
				title: "Picture or colour behind the page",
				sel: ".omni-backdrop (.omni-colour, .omni-waiting) · .omni-backdrop-was (.going)",
				desc: "Since v2, a picture, an animated GIF or WebP, a looping video, or one colour (.omni-colour) can be set behind OmniCore's own pages (Settings, Appearance tab). It's drawn as the first thing inside <code>&lt;body&gt;</code>, fixed to the screen behind everything, as it is, at the Picture brightness picked. What keeps text readable is the glass over it: since Phase A of 2.0.0 the Dim darkens the glass, not the picture, and one Auto (<code>solveGlass()</code> in <code>core/backdrop.js</code>) keeps the text at a contrast of 4.5 or more. A page's title, on the picture with no glass under it, is white or black by the picture itself (<code>--on-picture-fg</code>), flat, and a glass button outside any box gets the glass's tint and Dim. Nothing is drawn with the plain background. A page doesn't write this itself: <code>backdropHtml()</code> does, and the page's port serves the file at <code>/backdrop/…</code>.",
				demo: `<div style="position:relative;height:140px;border-radius:var(--radius);overflow:hidden;background:linear-gradient(135deg,#3a6df0,#c46cd8 55%,#f2a65a)">
<div class="segment" style="position:absolute;left:1em;right:1em;top:1.5em;color:#fff;background-color:rgba(255,255,255,0.07);background-image:linear-gradient(rgba(0,0,0,0.35),rgba(0,0,0,0.35));backdrop-filter:blur(20px) saturate(1.4);-webkit-backdrop-filter:blur(20px) saturate(1.4)">A segment over a picture, its glass dimmed</div>
</div>`,
				code: '<body>\n${backdropHtml()}\n…',
				note: "With reduced motion turned on in the device's settings, an animation shows its still frame and a video doesn't play. A video pauses while its tab is hidden. It fades in: a picture still loading waits as .omni-waiting and fades in once ready, and after a reload that changed the background (Change background's Use), a copy of the old one (.omni-backdrop-was) sits on top and fades away (.going) once the new one is ready. Call <code>omniKeepBackdrop()</code> just before such a reload. No fade with reduced motion."
			},
			{
				id: "curtain",
				title: "Page fade (the curtain)",
				sel: ".omni-curtain · html.omni-arriving · html.omni-leaving",
				desc: "Since v2, going from one page to another fades the page out to its base colour (<code>--curtain</code>: black, or Beige Cream with black text on the Default background) and the next one in from it. Every page starts its <code>&lt;body&gt;</code> with the curtain (<code>pageStart()</code> in <code>core/page-motion.js</code>). <b>html.omni-arriving</b> lifts it, only when a page is arrived at by a link, an address or first opening it, never on a reload or going back. <b>html.omni-leaving</b> drops it, on a click on an ordinary link or <code>omniGo(address)</code> from a page's script. Links opened in a new tab, downloads and <code>#</code> links on the same page don't fade.",
				demo: `<p class="muted" style="margin:0">Open any other page of the docs site's Default UI from OmniCore itself to see it; the docs site doesn't fade.</p>`,
				code: '<body>\n${pageStart()}\n…\n<script>omniGo("/faces");</script>',
				note: "With reduced motion turned on in the device's settings, pages change without a fade. A face's theme can wait for the curtain with the <code>omnicore:revealed</code> event; see Building theme.md."
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
				id: "glass-danger",
				base: "glass",
				title: "Glass button for something final",
				sel: ".glass.glass-danger",
				desc: "The same glass button, in the danger colour, for something that can't be taken back: deleting a face, removing a widget. It reads as careful before anyone reads the word on it. Pointed at or focused, it glows red rather than the usual white (since 1.19.9).",
				demo: '<button class="glass glass-danger">Delete face</button>',
				code: '<button class="glass glass-danger">Delete face</button>',
				note: "Ask first, with confirmDialog and danger: true, so the yes in the question is the same red button."
			},
			{
				id: "glass-small",
				base: "glass",
				title: "Small and wide glass buttons",
				sel: ".glass.small / .glass.wide",
				desc: "The same glass button, smaller, for the buttons on a row or beside a box's heading (Look again, Show password, Edit); or as wide as its box, for a pop-up's last button (Forget this network). In a settings field, a small one keeps its own width rather than stretching.",
				demo: '<button class="glass small">Edit</button> <button class="glass small">Look again</button><div style="max-width:18em;margin-top:0.8em"><button class="glass glass-danger wide">Forget this network</button></div>',
				code: '<button class="glass small">Edit</button>\n<button class="glass glass-danger wide">Forget this network</button>'
			},
			{
				id: "glass-medium",
				base: "glass",
				title: "Medium glass button",
				sel: ".glass.medium · .search-row > .glass",
				desc: "Between the full size and <b>.small</b>: Search beside a search box, Save location. In a <b>.search-row</b> it keeps its width and the box takes the rest.",
				demo: `<div class="search-row" style="max-width:26em"><input type="text" placeholder="Regina"><button class="glass medium">Search</button></div>`,
				code: "<button class=\"glass medium\">Search</button>"
			},
			{
				id: "glass-block",
				base: "glass",
				title: "Full-width glass button",
				sel: ".glass-block",
				desc: "A glass button as wide as its box, its words in the middle: Check now, Sign in, Go to Marketplace. A link can be one too.",
				demo: `<div style="max-width:22em"><button class="glass glass-block">Check now</button></div>`,
				code: "<button class=\"glass glass-block\">Check now</button>\n<a class=\"glass glass-block\" href=\"/marketplace\">Go to Marketplace</a>"
			},
			{
				id: "glass-off",
				base: "glass",
				title: "Button that can't be pressed yet",
				sel: ".glass.is-off",
				desc: "Looks off and doesn't glow, but still shows its title on hover, saying why (a disabled button shows none in most browsers): Upgrade, until the backup is made. On a phone, with no hover, the reason is written under it.",
				demo: `<button class="glass is-off" title="Make a backup first">Upgrade</button>`,
				code: "<button class=\"glass is-off\" title=\"Why it can't be pressed yet\" aria-disabled=\"true\">Upgrade</button>"
			},
			{
				id: "glass-big",
				base: "glass",
				title: "Big glass button",
				sel: ".glass.big · .done",
				desc: "A tap target meant to be hit from a phone at arm's length, not clicked with a mouse: an Inport's buttons. <b>.done</b> turns a button or a box green for a moment after a tap, so someone on a phone knows it registered.",
				demo: `<button class="glass big">On</button> <button class="glass big done">Off</button>`,
				code: "<button class=\"glass big\">On</button>\n\n// for a moment after a tap:\nbutton.classList.add(\"done\");"
			},
			{
				id: "button-row",
				title: "Buttons in a row",
				sel: ".buttons (.to-end)",
				desc: "A few buttons side by side, each as wide as its words, wrapping onto a second line when there isn't room (Join and Cancel under a password). With .to-end the row sits at the end of its box with its buttons on the right and a .status line on their left (the Appearance tab's Cancel and Save, two coloured buttons). A pop-up's last row is the same element with .dialog-buttons, which makes every button equally wide: see the pop-up question below.",
				demo: '<div class="buttons"><button class="glass">Join</button><button class="glass">Cancel</button></div>',
				code: '<div class="buttons">\n\t<button class="glass">Join</button>\n\t<button class="glass">Cancel</button>\n</div>'
			},
			{
				id: "segment-actions",
				title: "Actions at the end of a box",
				sel: ".segment-actions · .update-buttons",
				desc: "What a box does at the end, one under another with even room between: Save and its message, Check now and Go to Marketplace (<b>.segment-actions</b>). <b>.update-buttons</b> puts Check now and Update now side by side, wrapping when there isn't room, with a hint under them on a line of its own.",
				demo: `<div class="segment-actions" style="max-width:22em"><button class="glass glass-block">Check now</button><p class="status good">Up to date.</p><a class="glass glass-block" href="#segment-actions">Go to Marketplace</a></div>`,
				code: "<div class=\"segment-actions\">\n\t<button class=\"glass glass-block\">Check now</button>\n\t<p class=\"status\" id=\"check-status\"></p>\n\t<a class=\"glass glass-block\" href=\"/marketplace\">Go to Marketplace</a>\n</div>"
			},
			{
				id: "glossy",
				title: "Coloured buttons",
				sel: ".btn-glossy .btn-glossy-green / .btn-glossy-neutral",
				desc: "For the few moments that should stand out: green for the safe or finished choice (“Installed”, “Go back”), grey for the second choice. Smaller and squarer than a glass button. Both are glass since v2: the green is a see-through green tint with green words, the grey is plain glass. Over a picture or a colour the green is solid green with white words instead (since 2.0.0), so it reads the same over a warm picture as over any other. Always pair .btn-glossy with one colour class. The green has its own colours (--success-button-*), so it can be calmer than the green of good status text.",
				demo: '<button class="btn-glossy btn-glossy-green">Installed</button> <button class="btn-glossy btn-glossy-neutral">Cancel</button> <button class="btn-glossy btn-glossy-green" disabled>Disabled</button>',
				code: '<button class="btn-glossy btn-glossy-green">Installed</button>\n<button class="btn-glossy btn-glossy-neutral">Cancel</button>',
				note: "With white text they're glossy, with a bevel. With black text on the Default background they're flat: white label, no shadow."
			},
			{
				id: "dock",
				title: "Capsule (dock)",
				sel: ".dock > button (+ .danger)",
				desc: "One continuous capsule holding two or three actions, with a thin line between them: the wizard's Cancel | Back | Next, a module's Save | Remove. It sits in the page, not floating over it. Each section glows like a glass button. The capsule keeps the same width however many sections it has (26em upright, 30em on a wide screen), and nothing in it is ever marked as chosen.",
				demo: '<div class="center-row"><div class="dock"><button type="button">Save</button><button type="button" class="danger">Remove</button></div></div>',
				code: '<div class="dock">\n\t<button type="button">Save</button>\n\t<button type="button" class="danger">Remove</button>\n</div>',
				note: ".danger gives a section a red label and a red glow: a warning, not the safeguard. The action should still ask before doing anything. The capsule doesn't clip its contents on purpose, since that would clip the glow too. On a widget's page (since 1.19.9) the page is docked: it fills the window, the capsule stays at the bottom, and long settings scroll inside their own box."
			},
			{
				id: "dock-disabled",
				base: "dock",
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
				desc: "A flat round button pinned to a corner of the screen: the Back button (&#8592;). On the settings home it signs out instead, so backButton(\"/logout\") draws a sign-out icon and says \"Sign out\". It's deliberately not glossy: it glows softly on hover and flashes when tapped (.flash, or while pressed). Which corner is a setting. Bottom-left is never offered: that's where the welcome face's timer lives. The page keeps room free for it, at the top or the bottom, so nothing ends up under it. The About face, which has its own look, gets this button and its room from backButtonStyles().",
				stage: 150,
				demo: '<button class="floating top-left" aria-label="Back">&#8592;</button><button class="floating bottom-right" aria-label="Back">&#8592;</button><span class="muted stage-caption">top-left and bottom-right</span>',
				code: '<button class="floating bottom-right" aria-label="Back"\n\tonclick="location.href=\'/\'">&#8592;</button>\n\n// or let the helper write it, in the corner from Settings:\nbackButton("/")',
				note: "Here it's kept inside its box. On a real page it's pinned to the window's corner."
			},
			{
				id: "corner-button",
				base: "floating",
				title: "Corner button",
				sel: ".floating.top-right.corner-button",
				desc: "A smaller round floating button in the top-right corner: the welcome face's Settings button, a gear, which opens the admin face. (Until 2.0.0 the Light / Dark / Device switch sat there, on the welcome face and the sign-in page. The font colour picks the everyday colours now.)",
				stage: 110,
				demo: '<div class="floating top-left corner-button" style="cursor:default" aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1l2.1-2.1M17 7l2.1-2.1"></path></svg></div>',
				code: '<button class="floating top-right corner-button"\n\taria-label="Settings">…</button>',
				note: "Here it's kept inside its box. On the welcome face it's pinned to the window's corner."
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
				id: "box-head",
				title: "Box heading",
				sel: ".segment h2 · .form-stack > h2 · .box-head",
				desc: "A box's title, in a segment or at the top of a form stack. In a .box-head it shares its line with something at the end: an ⓘ, or a small button like Look again.",
				demo: '<div class="segment" style="max-width:24em"><div class="box-head"><h2>Networks around</h2><button type="button" class="glass small">Look again</button></div><p class="hint">The list is under the heading.</p></div>',
				code: '<div class="segment">\n\t<div class="box-head">\n\t\t<h2>Networks around</h2>\n\t\t<button class="glass small">Look again</button>\n\t</div>\n\t…\n</div>'
			},
			{
				id: "spaced",
				base: "box-head",
				title: "Room under it",
				sel: ".segment .spaced",
				desc: "A box's heading, or a line in it, with room under it: for one followed by a list, rows or a form rather than a line of text (Modules, a widget's Settings, the location switch).",
				demo: `<div class="segment" style="max-width:22em"><h2 class="spaced">Settings</h2><div class="field" style="margin:0"><label>Label</label><input type="text"></div></div>`,
				code: "<h2 class=\"spaced\">Settings</h2>"
			},
			{
				id: "segment-clickable",
				base: "segment",
				title: "Clickable segment",
				sel: ".segment.clickable",
				desc: "A segment where the whole box is a link or a button. With white text it glows when pointed at; with black text on Beige Cream it lifts slightly instead, because a glow disappears against a pale page.",
				demo: '<div class="segment clickable" tabindex="0">Point at me: a clickable segment.</div>',
				code: '<a class="segment clickable" href="/faces/001">…</a>'
			},
			{
				id: "row-link",
				title: "Row link",
				sel: ".row (+ .glass)",
				desc: "A line that goes somewhere, with a quieter line under its name: a face in the Faces list, Widgets and Theme on a face's page, a module to add. As <b>.row.glass</b> it's a glass button laid out as a row, with the same glow, fade and press.",
				demo: `<div class="settings-page" style="max-width:24em"><a class="row glass" href="#row-link"><strong>Widgets</strong><span>1 widget</span></a></div>`,
				code: "<a class=\"row glass\" href=\"/faces/4001/modules\">\n\t<strong>Widgets</strong>\n\t<span>1 widget</span>\n</a>"
			},
			{
				id: "module-rows",
				title: "Module rows",
				sel: ".flat · .picked (+ .removable, .current) · .review-row",
				desc: "The wizard's two sides of one decision, the same shape on purpose: a module to add (<b>.flat</b>, green on hover) and one already added (<b>.picked</b>; red on hover when clicking it removes it, <b>.removable</b>; brighter when it's the one being set up, <b>.current</b>). <b>.review-row</b> is a line of the review: what, and what it's set to.",
				demo: `<div style="display:grid;gap:0.5em;max-width:22em"><button type="button" class="flat">Weather<small>The weather where you are</small></button><button type="button" class="picked removable">Weather<small>Click to remove</small></button><div class="review-row"><strong>Theme</strong><span>Windows 8</span></div></div>`,
				code: "<button class=\"flat\">Weather<small>…</small></button>\n<button class=\"picked removable\">Weather<small>…</small></button>\n<div class=\"review-row\"><strong>Theme</strong><span>Windows 8</span></div>"
			},
			{
				id: "info-order",
				title: "Info order list",
				sel: ".priority-row (+ .dragging) > .priority-grip, .priority-rank, .priority-name, .priority-move · .sorting · .glass.priority-open > .priority-summary, .priority-open-hint · .modal.priority-modal > .priority-list",
				desc: "Things to put in order: dragged by the grip, or moved with the arrows, numbered as they go. The row being dragged sits above the others in the page's own colour and follows the pointer (<b>.dragging</b>, how far is <code>--drag-y</code>); the whole list is <b>.sorting</b> meanwhile. A long list is a button showing the order in short form (<b>.priority-open</b>) that opens a taller pop-up whose list scrolls (<b>.priority-modal</b>).",
				demo: `<div style="max-width:24em"><div class="priority-row"><span class="priority-grip" aria-hidden="true">⋮⋮</span><span class="priority-rank">1</span><span class="priority-name">Temperature</span><button type="button" class="priority-move" disabled aria-label="Up">▲</button><button type="button" class="priority-move" aria-label="Down">▼</button></div><div class="priority-row"><span class="priority-grip" aria-hidden="true">⋮⋮</span><span class="priority-rank">2</span><span class="priority-name">Condition</span><button type="button" class="priority-move" aria-label="Up">▲</button><button type="button" class="priority-move" disabled aria-label="Down">▼</button></div></div>`,
				code: "// priority-ui.js writes it:\npriorityFieldHtml(field, value)"
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
				desc: "A single line you can pick in a list: a name on the left and a small label pinned to the right (a .hint). A plain button, lit on hover, not a box (since v2 a box is frosted glass, and a list of them looked like a pile of cards). The font picker uses it; it suits any long list that reads better one line per entry.",
				demo: '<div class="list"><button type="button" class="font-row"><strong>Bitcount Ink</strong><span class="hint">display</span></button><button type="button" class="font-row"><strong>Pixelify Sans</strong><span class="hint">sans-serif</span></button></div>',
				code: '<button type="button" class="font-row">\n\t<strong>Name</strong><span class="hint">label</span>\n</button>'
			},
			{
				id: "list-tight",
				base: "list",
				title: "Tight and short lists",
				sel: ".list.tight / .list.short",
				desc: "A scrolling list with less room around its rows (.tight), for rows that carry two lines and buttons; and one that scrolls after a few rows (.short), in a pop-up.",
				demo: '<div class="list tight"><div class="item"><div class="item-text"><span>Mom\'s place</span><span class="item-sub">Joins automatically</span></div><div class="item-actions"><button class="glass small">Edit</button></div></div><div class="item"><div class="item-text"><span>Superstore Staff</span><span class="item-sub">Doesn\'t join automatically</span></div><div class="item-actions"><button class="glass small">Edit</button></div></div></div>',
				code: '<div class="list tight">…</div>\n<div class="list short">…</div>'
			},
			{
				id: "item",
				title: "Item",
				sel: ".item .item-main .item-text .item-sub .item-end .item-actions (+ .current)",
				desc: "A row with a second line under its name (.item-sub), maybe an icon at the start (.item-main holds the icon and the words), and an icon (.item-end) or buttons (.item-actions) at the end. On a .font-row it can be picked, like a network around; on its own it's a plain row whose buttons do the picking, like a known network. .current marks the one in use: its second line turns green. A row that can't be picked has aria-disabled=\"true\" and is quieter, unless it's the current one. On a phone the buttons go under the name, and wrap onto another line when there are more than fit (a profile's, in the Profiles pop-up).",
				demo: '<div class="list tight"><button type="button" class="font-row item current" aria-disabled="true"><span class="item-main"><span class="item-text"><span>Tanzim\'s 5G</span><span class="item-sub">Connected</span></span></span><span class="item-end"><svg viewBox=\"0 0 24 24\" width=\"15\" height=\"15\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/></svg></span></button><button type="button" class="font-row item"><span class="item-main"><span class="item-text"><span>Lobby Guests</span><span class="item-sub">2.4 GHz</span></span></span><span class="item-end"><svg viewBox=\"0 0 24 24\" width=\"15\" height=\"15\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" aria-hidden=\"true\"><rect x=\"5\" y=\"11\" width=\"14\" height=\"10\" rx=\"2\"/><path d=\"M8 11V8a4 4 0 0 1 8 0v3\"/></svg></span></button><div class="item"><div class="item-text"><span>Home</span><span class="item-sub good">In use</span></div><div class="item-actions"><button class="glass small">Show password</button><button class="glass small">Edit</button></div></div></div>',
				code: '<button type="button" class="font-row item">\n\t<span class="item-main">\n\t\t<svg>…</svg>\n\t\t<span class="item-text"><span>Name</span><span class="item-sub">Second line</span></span>\n\t</span>\n\t<span class="item-end"><svg>…</svg></span>\n</button>\n\n<div class="item">\n\t<div class="item-text"><span>Name</span><span class="item-sub good">In use</span></div>\n\t<div class="item-actions"><button class="glass small">Edit</button></div>\n</div>'
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
				id: "headline",
				title: "Headline",
				sel: ".headline (+ .signal .off)",
				desc: "What something is right now, at the top of a box: a big icon, a name in large type and a line under it, quiet or .good / .bad (the Wi-Fi the server is on). A signal-strength icon is .signal, with the bars it doesn't have marked .off.",
				demo: '<div class="headline"><svg class="signal" viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/><path d="M8.7 15.4a5 5 0 0 1 6.6 0"/><path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path class="off" d="M2.5 9a14 14 0 0 1 19 0"/></svg><div><strong>Tanzim\'s 5G</strong><span class="good">Connected, and online</span></div></div>',
				code: '<div class="headline">\n\t<svg class="signal">… <path class="off" …/></svg>\n\t<div><strong>Name</strong><span class="good">Connected, and online</span></div>\n</div>'
			},
			{
				id: "wide-second",
				title: "Two boxes, the second wider",
				sel: ".bento-row.two.wide-second",
				desc: "Two boxes side by side where the second needs more room (its rows have buttons). On a screen held upright they stack, as any row of two does.",
				demo: '<div class="bento-row two wide-second" style="display:grid;gap:14px"><div class="segment">Wi-Fi</div><div class="segment">Known networks</div></div>',
				code: '<div class="bento-row two wide-second">\n\t<div class="segment">…</div>\n\t<div class="segment">…</div>\n</div>'
			},
			{
				id: "qr-box",
				title: "QR code on its own",
				sel: ".qr-box",
				desc: "A QR code on its own, in a pop-up (Show password) or a frame (Manual Setup's OmniSync code): Core's own drawing (qr.js), kept square, never bigger than a phone needs and never more than about half the screen's height. Put the svg Core gives you inside it, never one from anywhere else.",
				demo: '<div class="qr-box" style="width:8em;margin:0"><svg viewBox="0 0 10 10" style="background:#fff"><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/><rect x="6" y="6" width="1" height="1"/><rect x="8" y="8" width="1" height="1"/></svg></div>',
				code: '<div class="qr-box">${qr.toSvg(value)}</div>'
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
				desc: "A centred panel over a dimmed, blurred screen, for a control that needs more room than its segment has (the font picker's results, the location search). Frosted glass like a segment (since v2): its fill, the tint, the light edge and the blur picked in Settings, plus a little shade and at least 16px of blur so what's behind never reads through. A .list inside it has no frame of its own. The backdrop covers the whole screen; give it the hidden attribute to hide it. At most 26em wide and 80% of the screen tall.",
				stage: 300,
				demo: '<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>Choose a font</h2><button class="modal-close" aria-label="Close">&#10005;</button></div><input type="text" placeholder="Search" aria-label="Search fonts"><div class="list"><button type="button" class="font-row"><strong>Adamina</strong><span class="hint">serif</span></button></div></div></div>',
				code: '<div class="modal-backdrop" hidden>\n\t<div class="modal">\n\t\t<div class="modal-head">\n\t\t\t<h2>Title</h2>\n\t\t\t<button class="modal-close">&#10005;</button>\n\t\t</div>\n\t\t…\n\t</div>\n</div>',
				note: "It has to sit outside every segment (see --segment-blur above). Here it's kept inside its box; normally it covers the whole window."
			},
			{
				id: "dialog",
				base: "modal",
				title: "Question pop-up (confirmDialog, askDialog)",
				sel: ".modal (.dialog-text, .dialog-link, .buttons.dialog-buttons)",
				desc: "A question in a pop-up instead of the browser's own confirm() or prompt() box: a title, a line of text, and two buttons side by side. askDialog adds a box to type into and keeps its confirm button off until something is typed. Built by DIALOG_SCRIPT, which every page on the Default UI carries: <code>await confirmDialog({ title, text, confirm, danger })</code> answers true or false, <code>await askDialog({ title, text, placeholder, secret, confirm })</code> answers what was typed, or null. Either takes <code>link: { text, url }</code> for a small link under the text (.dialog-link), such as where to get an API key; only an https:// address becomes one.",
				stage: 260,
				demo: '<div class="modal-backdrop"><div class="modal"><h2>Delete this face?</h2><p class="dialog-text">Its widgets and settings go with it.</p><div class="buttons dialog-buttons"><button class="glass">Cancel</button><button class="glass glass-danger">Delete</button></div></div></div>',
				code: 'const sure = await confirmDialog({\n\ttitle: "Delete this face?",\n\ttext: "Its widgets and settings go with it.",\n\tconfirm: "Delete",\n\tdanger: true\n});',
				note: "Cancel, Escape and a click outside the panel are all a no. Cancel has the focus, so an Enter pressed out of habit is never the yes."
			},
			{
				id: "major-modal",
				base: "modal",
				title: "Major version pop-up",
				sel: ".modal.major-modal > .major-doc (.major-ours) · .major-actions (.major-why)",
				desc: "What a new major version changes: wider and taller than other pop-ups, the document scrolling inside it (<b>.major-doc</b>, with OmniCore's own part after a line, <b>.major-ours</b>), and Upgrade under it (<b>.major-actions</b>). <b>.major-why</b> says why Upgrade can't be pressed yet, on a phone.",
				stage: 260,
				demo: `<div class="modal-backdrop"><div class="modal major-modal"><h2>OmniCore 3</h2><div class="major-doc"><p>What's changing, and what to do first.</p><p class="major-ours">From OmniCore itself.</p></div><div class="major-actions"><button class="glass">Upgrade</button></div></div></div>`,
				code: "<div class=\"modal major-modal\">\n\t<h2>OmniCore 3</h2>\n\t<div class=\"major-doc\">…</div>\n\t<div class=\"major-actions\">\n\t\t<button class=\"glass is-off\" title=\"…\">Upgrade</button>\n\t\t<p class=\"hint major-why\">…</p>\n\t</div>\n</div>"
			},
			{
				id: "background-modal",
				base: "modal",
				title: "Background pop-up",
				sel: ".modal.modal-wide > .bg-preview (.bg-preview-colour, .bg-preview-card) · .bg-tabs · .bg-pane",
				desc: "Change background: a wider pop-up, a live preview with a piece of glass on it to judge the text by (<b>.bg-preview-card</b>), then Picture, Colour and Default (<b>.bg-tabs</b>, a pane each, <b>.bg-pane</b>). Set by the pop-up's script as the choice changes: the preview's colour (<code>--colour</code>) and the brightness a new picture starts at (<code>--preview-brightness</code>), and the glass as Auto would make it there: its fill, its tint with the Dim, its blur and its text colour (<code>--card-fill</code>, <code>--card-tint</code>, <code>--card-blur</code>, <code>--card-fg</code>).",
				stage: 440,
				demo: `<div class="modal-backdrop"><div class="modal modal-wide"><h2>Change background</h2><div class="bg-preview"><span class="bg-preview-colour" style="--colour:#24423b"></span><span class="bg-preview-card">Text on the glass</span></div><div class="tabs bg-tabs"><button type="button" class="tab-btn">Picture</button><button type="button" class="tab-btn active">Colour</button><button type="button" class="tab-btn">Default</button></div></div></div>`,
				code: "<div class=\"modal modal-wide\">\n\t<div class=\"bg-preview\">\n\t\t<span class=\"bg-preview-colour\"></span>\n\t\t<img alt=\"\" hidden>\n\t\t<span class=\"bg-preview-card\">Text on the glass</span>\n\t</div>\n\t<div class=\"tabs bg-tabs\">…</div>\n\t<div class=\"bg-pane\" data-bg-pane=\"picture\">…</div>\n</div>"
			},
			{
				id: "link-tile",
				base: "segment-clickable",
				title: "Link tile",
				sel: ".home-tile > svg · .tile-text",
				desc: "A whole box that is a link, with a big icon at the top and its name and a line under it at the foot: the Resources tab's Network, Manage Faces, Installed Resources and Marketplace. It glows on hover like any clickable box, and takes whatever room its place on the grid gives it.",
				demo: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1em;max-width:36em"><a class="segment clickable home-tile" href="#link-tile"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg><span class="tile-text"><strong>Manage Faces</strong><span>Create, edit and remove dashboards</span></span></a></div>`,
				code: '<a class="segment clickable home-tile" href="/faces">\n\t<svg>…</svg>\n\t<span class="tile-text"><strong>Manage Faces</strong><span>Create, edit and remove dashboards</span></span>\n</a>\n\n// or let settings-home.js write it:\ntileHtml("/faces", "faces", "Manage Faces", "Create, edit and remove dashboards", "c4 row1")'
			},
			{
				id: "tile-off",
				base: "link-tile",
				title: "Tile that leads nowhere",
				sel: ".home-tile.home-tile-off",
				desc: "The same box when there's nowhere to go: a plain box, not a link, with its icon faded so it doesn't look like something to press, and its line saying why (the Network tile when OmniCore can't change the Wi-Fi).",
				demo: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1em;max-width:36em"><div class="segment home-tile home-tile-off"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path d="M8.7 15.4a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></svg><span class="tile-text"><strong>Network</strong><span>This OmniCore can't change the server's Wi&#8209;Fi.</span></span></div></div>`,
				code: '<div class="segment home-tile home-tile-off">…</div>\n\n// or:\nstaticTileHtml("network", "Network", reason, "c2 row2")'
			},
			{
				id: "tile-slides",
				base: "link-tile",
				title: "Tile with pictures",
				sel: ".home-tile.has-slides > .tile-slides > img (+ .on)",
				desc: "A link tile with pictures filling it, crossfading one into the next (the one showing is <b>.on</b>), darkened towards the bottom so its name reads over any of them, with black text too. The Marketplace tile, with each registry's banner. <b>.has-slides</b> is only added once a picture has loaded, so a tile whose pictures never arrive looks like any other. Still with reduced motion.",
				demo: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1em;max-width:36em"><a class="segment clickable home-tile has-slides" href="#tile-slides"><span class="tile-slides" aria-hidden="true"><img class="on" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 3'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%23f2a65a'/%3E%3Cstop offset='.5' stop-color='%23b4476b'/%3E%3Cstop offset='1' stop-color='%231d4f7a'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='4' height='3' fill='url(%23g)'/%3E%3C/svg%3E"></span><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg><span class="tile-text"><strong>Marketplace</strong><span>Modules and themes to install</span></span></a></div>`,
				code: '<a class="segment clickable home-tile has-slides" href="/marketplace">\n\t<span class="tile-slides" aria-hidden="true"><img class="on" src="…" alt=""><img src="…" alt=""></span>\n\t<svg>…</svg>\n\t<span class="tile-text">…</span>\n</a>'
			},
			{
				id: "facts",
				title: "Fact rows",
				sel: ".facts > .fact (.fact-label, .fact-value, .hint)",
				desc: "A label on the left and its value on the right, one fact under another with a line between them: the About tab, the Network page's Wi&#8209;Fi, a face's page. A <b>.hint</b> in a row goes under it, across the whole row. A face's facts use <b>.fact-label</b> and <b>.fact-value</b>, which puts the value in bold.",
				demo: `<div class="segment" style="max-width:26em"><div class="facts"><div class="fact"><span class="fact-label">Outport</span><span class="fact-value">4001</span></div><div class="fact"><span class="fact-label">Showing on</span><span class="fact-value">2 screens</span><span class="hint">OmniViews and browser tabs with this face open</span></div><div class="fact"><span>Version</span><span>OmniCore 2.0.0</span></div></div></div>`,
				code: '<div class="facts">\n\t<div class="fact"><span class="fact-label">Showing on</span><span class="fact-value">2 screens</span>\n\t\t<span class="hint">OmniViews and browser tabs with this face open</span></div>\n\t<div class="fact"><span>Version</span><span>OmniCore 2.0.0</span></div>\n</div>'
			},
			{
				id: "inset",
				title: "Inset strip",
				sel: ".inset > .inset-text (.inset-label, .inset-value .coords) · .inset > .glass",
				desc: "A value, not a control: a sunken strip in a box with a small label over the value, and maybe a small button at its end (the location detected, with Refresh; the font, with Change). <b>.coords</b> puts a place's coordinates a little apart, quieter.",
				demo: `<div class="inset" style="max-width:26em"><div class="inset-text"><div class="inset-label">CURRENTLY DETECTED</div><div class="inset-value">Regina<span class="coords">50.445, -104.619</span></div></div><button class="glass">Refresh</button></div>`,
				code: "<div class=\"inset\">\n\t<div class=\"inset-text\">\n\t\t<div class=\"inset-label\">FONT</div>\n\t\t<div class=\"inset-value\">System font</div>\n\t</div>\n\t<button class=\"glass\">Change</button>\n</div>"
			},
			{
				id: "major-box",
				base: "inset",
				title: "Major version box",
				sel: ".inset.major-box (.major-box-text, .major-box-go)",
				desc: "A new major version of OmniCore, at the top of the Updates box: an inset strip that's a button, glowing on hover, with what's new and an arrow. It opens the major version pop-up.",
				demo: `<button type="button" class="inset major-box" style="max-width:26em"><span class="major-box-text"><strong>OmniCore 3 is here!</strong><span>See what's changing</span></span><span class="major-box-go" aria-hidden="true">&#8250;</span></button>`,
				code: "<button type=\"button\" class=\"inset major-box\">\n\t<span class=\"major-box-text\"><strong>OmniCore 3 is here!</strong><span>…</span></span>\n\t<span class=\"major-box-go\">&rsaquo;</span>\n</button>"
			},
			{
				id: "saved-key",
				title: "Saved key row",
				sel: ".saved-key (.saved-key-text, .saved-key-buttons)",
				desc: "One saved key: the service, a quieter line under it, and its buttons at the end, with a line above it. Saved keys, under the Location Service.",
				demo: `<div style="max-width:28em"><div class="saved-key"><div class="saved-key-text"><strong>GeoNames</strong><span>Username saved</span></div><div class="saved-key-buttons"><button class="glass">Change</button><button class="glass">Remove</button></div></div></div>`,
				code: "<div class=\"saved-key\">\n\t<div class=\"saved-key-text\"><strong>GeoNames</strong><span>Username saved</span></div>\n\t<div class=\"saved-key-buttons\">…</div>\n</div>"
			},
			{
				id: "release-notes",
				title: "Release notes",
				sel: ".release-notes > .notes-body > .notes-part > .changelog (h3, ul, li, p, strong, code)",
				desc: "The notes of a release, read inside their box: each part side by side when there's room (<b>.notes-part</b>), each scrolling on its own. On the About tab the box takes the room left under the boxes above it. A name written between backticks is drawn as code.",
				demo: `<div class="notes-body"><div class="notes-part"><h3>2.0.0</h3><div class="changelog"><h3>Added</h3><ul><li><strong>Frosted glass.</strong> Every box on OmniCore's pages, over the background.</li><li>A <code>qr</code> block can say what to print instead.</li></ul></div></div></div>`,
				code: "<div class=\"segment release-notes\">\n\t<div class=\"notes-body\">\n\t\t<div class=\"notes-part\"><h3>2.0.0</h3><div class=\"changelog\">…</div></div>\n\t</div>\n</div>"
			},
			{
				id: "about-box",
				base: "segment-clickable",
				title: "About box",
				sel: ".about-box > .about-box-head",
				desc: "The OmniCore box on the About tab: the whole box is a link to System info, its heading with an arrow at the end, then its facts.",
				demo: `<a class="segment clickable about-box" href="#about-box" style="max-width:24em"><div class="about-box-head"><h2>OmniCore</h2><span aria-hidden="true">&#8599;</span></div><div class="fact"><span>Version</span><span>OmniCore 2.0.0</span></div></a>`,
				code: "<a class=\"segment clickable about-box\" href=\"#\">\n\t<div class=\"about-box-head\"><h2>OmniCore</h2><svg>…</svg></div>\n\t<div class=\"fact\"><span>Version</span><span>…</span></div>\n</a>"
			},
			{
				id: "resource-facts",
				title: "Installed resource facts",
				sel: ".resource-facts · .resource-status (+ .good, .bad)",
				desc: "What's installed, in small quiet words under its name, side by side as there's room: its version, where it came from, and how current it is (<b>.resource-status</b>, green when up to date, red when something's wrong).",
				demo: `<div class="segment" style="max-width:26em"><h2>Weather</h2><div class="resource-facts"><span>v1.4.0</span><span>Omnia Registry</span><span class="resource-status good">Up to date</span></div></div>`,
				code: "<div class=\"resource-facts\">\n\t<span>v1.4.0</span>\n\t<span class=\"resource-status good\">Up to date</span>\n</div>"
			},
			{
				id: "backdrop-preview",
				title: "Background preview",
				sel: ".backdrop-stage > .backdrop-preview (+ .plain) > .preview-colour (+ .preview-default), .preview-kind · .corner-mark (.corner-mark-top-left, .corner-mark-bottom-right) · .change-label · .back-corner",
				desc: "The Background box: what's behind the pages, drawn small (a picture, or a colour from <code>--colour</code>, or the Default, <b>.preview-default</b>), with what it is in its corner (<b>.preview-kind</b>) and the Back button drawn where it sits (<b>.corner-mark</b>). The whole preview is a button (<b>.backdrop-stage</b>): it dims on hover and says Change background (<b>.change-label</b>); on a touch screen a small Change sits in its corner instead. <b>.back-corner</b> is the Back button switch under it, two halves the width of the box.",
				demo: `<div style="max-width:22em"><button type="button" class="backdrop-stage"><span class="backdrop-preview"><span class="preview-colour" style="--colour:#1e2a44"></span><span class="preview-kind">#1e2a44</span></span><span class="corner-mark corner-mark-bottom-right" aria-hidden="true">&#8592;</span><span class="change-label" aria-hidden="true">Change background</span></button></div>`,
				code: "<button type=\"button\" class=\"backdrop-stage\" aria-label=\"Change background\">\n\t<span class=\"backdrop-preview\">\n\t\t<span class=\"preview-colour\" style=\"--colour:#1e2a44\"></span>\n\t\t<span class=\"preview-kind\">#1e2a44</span>\n\t</span>\n\t<span class=\"corner-mark corner-mark-bottom-right\">&#8592;</span>\n\t<span class=\"change-label\">Change background</span>\n</button>",
				note: "A colour only the page knows comes in as a CSS variable on the element (<code>style=\"--colour:#1e2a44\"</code>), never as a style of its own."
			},
			{
				id: "glass-fields",
				title: "Glass fields",
				sel: ".glass-fields > .field (+ .wide-field)",
				desc: "The Frosted glass box's settings: two to a row (Blur and Tint strength, then Picture brightness and Dim), with a <b>.wide-field</b> taking a row of its own (the Tint colours). One to a row on a phone held upright.",
				demo: `<div class="glass-fields" style="max-width:30em"><div class="field"><label>Blur 20 px</label><input type="range" value="40"></div><div class="field"><label>Tint strength 12%</label><input type="range" value="30"></div></div>`,
				code: "<div class=\"glass-fields\">\n\t<div class=\"field wide-field\">…</div>\n\t<div class=\"field\">…</div>\n\t<div class=\"field\">…</div>\n</div>"
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
				desc: "A pill of named options, one of them chosen. Use it when the options are named things (Dark / Light for notifications, Modules / Themes, the corner names), not a plain on and off. Often each option shows different settings underneath. A disabled one is faded.",
				demo: '<div class="tabs" data-demo-tabs><button class="tab-btn active">Dark</button><button class="tab-btn">Light</button><button class="tab-btn">Device</button></div>',
				code: '<div class="tabs">\n\t<button class="tab-btn active">Dark</button>\n\t<button class="tab-btn">Light</button>\n</div>',
				note: "Clicking works here. On a real page, the page's own script moves .active."
			},
			{
				id: "switch",
				title: "Toggle",
				sel: "input[type=checkbox] (role=\"switch\")",
				desc: "Every on/off choice on OmniCore's own pages, since the v2 test run: there are no checkboxes to tick. It's still a real checkbox underneath (so a keyboard, a screen reader and a form treat it as one), drawn as a glass track with a knob that slides across, green when on. Write role=\"switch\" on it so a screen reader says \"switch\". In an .option row it sits at the end, after the words. Different from tabs on purpose: a toggle is on or off; tabs are a choice between named things.",
				demo: '<label class="option" style="margin-bottom:8px"><span>Let OmniCore know where it is</span><input type="checkbox" role="switch" checked></label><label class="option" style="margin-bottom:0"><span>Off</span><input type="checkbox" role="switch"></label>',
				code: '<label class="option">\n\t<span>Let OmniCore know where it is</span>\n\t<input type="checkbox" role="switch" checked>\n</label>'
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
				desc: "A bordered row holding a radio button and its words, or words and a toggle at the end; the whole row can be clicked. A stack of radio rows is a pick-one.",
				demo: '<label class="option"><input type="radio" name="demo-option" checked> Automatic</label><label class="option" style="margin-bottom:0"><input type="radio" name="demo-option"> Set it myself</label>',
				code: '<label class="option"><input type="radio" name="o"> Automatic</label>'
			},
			{
				id: "mode-previews",
				title: "Mode previews",
				sel: ".mode-previews (+ .narrow-previews) > .mode-preview (+ .active) > .mode-screen (+ .note-dark, .note-light) > .line (+ .head, .mid) · .mode-preview-label",
				desc: "A choice made by looking: a few little screens rather than a switch, each showing what it is, the one picked with a stronger edge (<b>.active</b>). A screen is a notification's colour (<b>.note-dark</b>, <b>.note-light</b>), with lines of \"text\" on it: a heading line, then fainter ones. <b>.narrow-previews</b> keeps them the size they are in a half-width box. On a face's page, for its notifications.",
				demo: `<div class="mode-previews narrow-previews"><div class="mode-preview active" role="button" tabindex="0"><div class="mode-screen note-dark"><span class="line head"></span><span class="line"></span></div><div class="mode-preview-label">Dark</div></div><div class="mode-preview" role="button" tabindex="0"><div class="mode-screen note-light"><span class="line head"></span><span class="line"></span></div><div class="mode-preview-label">Light</div></div></div>`,
				code: "<div class=\"mode-previews\">\n\t<div class=\"mode-preview active\" role=\"button\" tabindex=\"0\">\n\t\t<div class=\"mode-screen note-dark\"><span class=\"line head\"></span><span class=\"line\"></span></div>\n\t\t<div class=\"mode-preview-label\">Dark</div>\n\t</div>\n\t…\n</div>"
			},
			{
				id: "tint-chips",
				title: "Tint chips",
				sel: ".tint-chips > .tint-chip (+ .active, .tint-custom) > .tint-swatch",
				desc: "Pick-one chips: a word (None, or Dominant and Vibrant with their colour) or a colour (<b>.tint-swatch</b>, its colour <code>--colour</code>), the one picked edged in the text colour (<b>.active</b>). <b>.tint-custom</b> is the browser's own colour box, made round, for any colour.",
				demo: `<div class="tint-chips"><button type="button" class="tint-chip active"><span>None</span></button><button type="button" class="tint-chip"><span class="tint-swatch" style="--colour:#274654"></span><span>Dominant</span></button><button type="button" class="tint-chip"><span class="tint-swatch" style="--colour:#fe6e1f"></span><span>Vibrant</span></button><button type="button" class="tint-chip" aria-label="Blue"><span class="tint-swatch" style="--colour:#5b8def"></span></button><button type="button" class="tint-chip" aria-label="Rose"><span class="tint-swatch" style="--colour:#e46a8f"></span></button><label class="tint-chip tint-custom" title="Pick a colour"><input type="color" value="#37393e"></label></div>`,
				code: "<div class=\"tint-chips\">\n\t<button type=\"button\" class=\"tint-chip active\"><span>None</span></button>\n\t<button type=\"button\" class=\"tint-chip\" aria-label=\"Blue\"><span class=\"tint-swatch\" style=\"--colour:#5b8def\"></span></button>\n\t<label class=\"tint-chip tint-custom\"><input type=\"color\"></label>\n</div>"
			},
			{
				id: "colour-wheel",
				title: "Colour wheel",
				sel: ".wheel-row > .wheel > canvas, .wheel-knob · .wheel-side · .swatches > .swatch",
				desc: "OmniCore's own colour wheel, the same on every device: drag or use the arrow keys, the knob where the colour is (<code>--knob-x</code>, <code>--knob-y</code>, <code>--colour</code>), the wheel darker as Brightness goes down (<code>--brightness</code>). Beside it (<b>.wheel-side</b>), the Brightness slider, a box for a code, and a few ready-made colours (<b>.swatch</b>, each its <code>--colour</code>).",
				demo: `<div class="swatches"><button type="button" class="swatch" style="--colour:#0f1115" aria-label="#0f1115"></button><button type="button" class="swatch" style="--colour:#1e2a44" aria-label="#1e2a44"></button><button type="button" class="swatch" style="--colour:#24423b" aria-label="#24423b"></button><button type="button" class="swatch" style="--colour:#eedec5" aria-label="#eedec5"></button></div>`,
				code: "<div class=\"wheel-row\">\n\t<div class=\"wheel\" tabindex=\"0\" role=\"slider\"><canvas></canvas><span class=\"wheel-knob\"></span></div>\n\t<div class=\"wheel-side\">…<div class=\"swatches\"><button class=\"swatch\" style=\"--colour:#1e2a44\"></button></div></div>\n</div>\n\n// the script moves the knob:\nknob.style.setProperty(\"--knob-x\", \"62%\");"
			},
			{
				id: "auto-toggle",
				title: "Auto, and a slider it leaves alone",
				sel: ".auto-switch · .slider-head > .badge.badge-button · .glass-warning",
				desc: "The Frosted glass box's one Auto (<b>.auto-switch</b>, a switch with its word, in the box's head), and each slider's label with what's at the other end of its line (<b>.slider-head</b>): a Pinned badge when the slider was moved by hand, so Auto leaves it alone. The badge is a button (<b>.badge-button</b>): pressed, Auto may move that slider again. A note when the text may be hard to read (<b>.glass-warning</b>, in the text colour), in the Appearance tab's saving box.",
				demo: `<div class="field" style="max-width:24em;margin:0"><div class="slider-head"><label>Dim 23%</label><button type="button" class="badge badge-button">Pinned</button></div><input type="range" value="23"></div><label class="auto-switch"><span>Auto</span><input type="checkbox" role="switch" checked></label>`,
				code: "<label class=\"auto-switch\"><span>Auto</span><input type=\"checkbox\" role=\"switch\" id=\"glass-auto\"></label>\n\n<div class=\"slider-head\">\n\t<label for=\"dim\">Dim <span class=\"muted\">23%</span></label>\n\t<button type=\"button\" class=\"badge badge-button\">Pinned</button>\n</div>"
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
				id: "field-pair",
				base: "field",
				title: "Two fields side by side",
				sel: ".field.pair",
				desc: "Two fields sharing a row, each half of it: Latitude and Longitude.",
				demo: `<div class="field pair" style="max-width:26em;margin:0"><div><label>Latitude</label><input type="number" value="50.445"></div><div><label>Longitude</label><input type="number" value="-104.619"></div></div>`,
				code: "<div class=\"field pair\">\n\t<div><label>Latitude</label><input type=\"number\"></div>\n\t<div><label>Longitude</label><input type=\"number\"></div>\n</div>"
			},
			{
				id: "type-head",
				title: "Heading with a control",
				sel: ".type-head > .type-head-text · .type-row",
				desc: "A box's heading and its note on the left and a control on the right (Typography's size stepper), and underneath a row of what follows (<b>.type-row</b>: two strips side by side, Font colour's and the font's). On a narrow screen the control drops under the note rather than squeezing it, and the strip under the buttons.",
				demo: `<div class="type-head" style="max-width:30em"><div class="type-head-text"><h2 style="margin:0">Typography</h2><p class="hint">Dashboards are unaffected.</p></div><div class="stepper"><button class="glass" aria-label="Smaller">&minus;</button><input type="number" value="16"><span class="unit">px</span><button class="glass" aria-label="Bigger">+</button></div></div>`,
				code: "<div class=\"type-head\">\n\t<div class=\"type-head-text\"><h2>Typography</h2><p class=\"hint\">…</p></div>\n\t<div class=\"stepper\">…</div>\n</div>\n<div class=\"type-row\">\n\t<div class=\"inset\">…COLOUR…</div>\n\t<div class=\"inset\">…FONT…</div>\n</div>"
			},
			{
				id: "tab-actions",
				title: "Saving a tab",
				sel: ".tab-actions · .buttons.keeps-room",
				desc: "A tab's saving box (the Appearance tab's), with no heading: on the Appearance tab, first an inset strip naming the appearance profile this device uses, with a Profiles button that opens the Profiles pop-up (a .list.tight of .item rows: Use, Rename, Make default, Export, Delete; Import an .ocap and New profile under it). Then a line saying whether everything on the tab is saved, a warning when there's one, and Cancel and Save (a <b>.buttons.to-end</b> row) at its bottom right, there only while something isn't saved. Their row keeps its room while it's hidden (<b>.keeps-room</b>: unseen, can't be pressed), so the box never changes height and the tab's rows never reshape. Everything on the tab shows at once; nothing is kept until Save, and Cancel, or leaving the page, puts it back. Its height never changes with what it says.",
				demo: '<div class="segment tab-actions" style="max-width:26em;min-height:9em"><p class="hint">Not saved yet. Cancel, or leaving this page, puts it back.</p><div class="buttons to-end"><button type="button" class="btn-glossy btn-glossy-neutral">Cancel</button><button type="button" class="btn-glossy btn-glossy-green">Save</button></div></div>',
				code: '<div class="segment c3 row2 tab-actions">\n\t<div class="inset">…PROFILE ON THIS DEVICE…<button class="glass">Profiles</button></div>\n\t<p class="hint" id="appearance-state">Everything on this tab is saved.</p>\n\t<p class="help glass-warning" hidden></p>\n\t<div class="buttons to-end" hidden>\n\t\t<span class="status"></span>\n\t\t<button class="btn-glossy btn-glossy-neutral">Cancel</button>\n\t\t<button class="btn-glossy btn-glossy-green">Save</button>\n\t</div>\n</div>'
			},
			{
				id: "font-swatches",
				title: "Picked by how it looks",
				sel: ".font-swatches (.on-colour) > .font-swatch (+ .white-text, .black-text, .active); :root.font-white, :root.font-black",
				desc: "Font colour, on the Appearance tab, in a strip like the font's: two choices, \"Aa\" in white and in black, each on a piece of the background through the real glass (its fill, then the tint with the Dim, the picture at its brightness), so it shows how that colour reads before it's picked. Once one is picked, the page puts <code>.font-white</code> or <code>.font-black</code> on <code>&lt;html&gt;</code> and it shows at once, from the stylesheet: over a picture or a colour the text's own colours follow (the text, its grey, a red or green word) and nothing made of glass changes; on the Default background the whole page follows, black with white text or Beige Cream with black text, since that's what the font colour picks there (since 2.0.0, when Light and Dark mode went away). The background comes as <code>--swatch-picture</code> (a picture's address, a colour, or on the Default background each choice's own colour); the glass from the page's own variables, so the choices follow the sliders as they move. The one picked has a ring in the text's colour.",
				demo: `<div class="inset" style="max-width:24em"><div class="inset-text"><div class="inset-label">COLOUR</div><div class="inset-value">White</div></div><div class="font-swatches"><button type="button" class="font-swatch white-text active" style="--swatch-picture:linear-gradient(135deg,#3a6df0,#f2a65a)"><span>Aa</span></button><button type="button" class="font-swatch black-text" style="--swatch-picture:linear-gradient(135deg,#3a6df0,#f2a65a)"><span>Aa</span></button></div></div>`,
				code: "<div class=\"font-swatches\" role=\"group\" aria-label=\"Font colour\">\n\t<button type=\"button\" class=\"font-swatch white-text active\" style=\"--swatch-picture:url('/backdrop/…')\"><span>Aa</span></button>\n\t<button type=\"button\" class=\"font-swatch black-text\" style=\"--swatch-picture:url('/backdrop/…')\"><span>Aa</span></button>\n</div>"
			},
			{
				id: "location-manual",
				title: "Boxes that open under a choice",
				sel: ".location-manual",
				desc: "Fields that only belong to one choice, shown under it once it's picked, with a little room above: the location's own boxes under Set it myself.",
				demo: `<div class="location-manual" style="max-width:26em"><div class="field" style="margin:0"><label>Place name</label><input type="text" placeholder="Home"></div></div>`,
				code: "<div class=\"location-manual\" hidden>\n\t<div class=\"field\">…</div>\n</div>"
			},
			{
				id: "number-field",
				base: "field",
				title: "A number to send",
				sel: ".field.number-field",
				desc: "On an Inport's page: a plain box (not a button, so no glow) holding its label, a big box to type a number in, and its own button to send it.",
				demo: `<div class="field segment number-field" style="max-width:16em;margin:0"><label>Brightness</label><input type="number" placeholder="0 to 100"><button class="glass">Set</button></div>`,
				code: "<div class=\"field segment number-field\">\n\t<label for=\"field-level\">Brightness</label>\n\t<input id=\"field-level\" type=\"number\">\n\t<button class=\"glass\">Set</button>\n</div>"
			},
			{
				id: "inputs",
				title: "Text, address, number, password and drop-down",
				sel: "input[type=text | url | number | password], select",
				desc: "All five look the same: full width, glass fill, a thin border, rounded corners. A drop-down's list is given the page's colours too; left alone, the browser draws it white on white with white text.",
				demo: '<div class="field"><input type="text" placeholder="Text" aria-label="Text"></div><div class="field"><input type="url" placeholder="https://address" aria-label="Address"></div><div class="field"><input type="number" value="42" aria-label="Number"></div><div class="field"><input type="password" value="secret" aria-label="Password"></div><select aria-label="Drop-down"><option>Choice A</option><option>Choice B</option></select>',
				code: '<input type="text">\n<input type="url">\n<input type="number">\n<input type="password">\n<select><option>…</option></select>'
			},
			{
				id: "form-stack",
				title: "Form stack",
				sel: ".form-stack .switch-row",
				desc: "A form's labels, boxes and buttons one under another, evenly spaced, with its boxes as wide as the form: a pop-up's form, or a password asked for under a list. A .switch-row is a label with its switch at the end of the same line. Buttons under it go in a .buttons row.",
				demo: '<form class="form-stack" style="max-width:20em"><div class="switch-row"><label for="demo-auto">Join automatically</label><input type="checkbox" role="switch" id="demo-auto" checked></div><label for="demo-pass">Password</label><input type="password" id="demo-pass"><div class="buttons"><button type="button" class="glass">Join</button><button type="button" class="glass">Cancel</button></div></form>',
				code: '<form class="form-stack">\n\t<div class="switch-row"><label>Join automatically</label><input type="checkbox" role="switch"></div>\n\t<label>Password</label>\n\t<input type="password">\n\t<div class="buttons"><button class="glass">Join</button><button class="glass">Cancel</button></div>\n</form>'
			},
			{
				id: "form-stack-centred",
				title: "Centred stack",
				base: "form-stack",
				sel: ".form-stack.centred",
				desc: "A form stack with everything centred, one thing under another: a code to scan, a line under it, and a button (Manual Setup's OmniSync view). Its lines of text keep to a readable width.",
				demo: '<div class="form-stack centred" style="max-width:22em"><h2>Set up with OmniSync</h2><div class="qr-box" style="width:6em;margin:0"><svg viewBox="0 0 10 10" style="background:#fff"><rect x="1" y="1" width="3" height="3"/><rect x="6" y="1" width="3" height="3"/><rect x="1" y="6" width="3" height="3"/></svg></div><p class="muted">Open OmniSync on your phone and scan this code.</p><button type="button" class="glass">Set up manually</button></div>',
				code: '<section class="form-stack centred">\n\t<h2>Set up with OmniSync</h2>\n\t<div class="qr-box">…</div>\n\t<p class="muted">…</p>\n\t<button class="glass">Set up manually</button>\n</section>'
			},
			{
				id: "unit-row",
				title: "Number with its unit",
				sel: ".unit-row, .unit",
				desc: "A number box only as wide as a number needs, with its unit beside it on the same line: “Refresh every [ 10 ] minutes”. A setting asks for it with \"unit\"; a module's refreshMinutes always gets “minutes”.",
				demo: '<div class="field"><label>Refresh every</label><div class="unit-row"><input type="number" value="10" min="1" aria-label="Minutes"><span class="unit">minutes</span></div></div>',
				code: '<div class="unit-row">\n\t<input type="number" min="1">\n\t<span class="unit">minutes</span>\n</div>'
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
				title: "Slider and colour picker",
				sel: "input[type=range], input[type=color]",
				desc: "A slider is a thin glass track, filled up to a round knob that glows when it's pointed at or held. The filled part follows --fill, which CONTROLS_SCRIPT keeps up to date (a script that sets a slider's value calls omniFillRanges() after). The colour picker is full width and 46px tall, with the glass fill.",
				demo: '<input type="range" min="0" max="100" value="60" style="--fill:60%;margin-bottom:1em" aria-label="A slider"><input type="color" value="#4a90e2" aria-label="Colour">',
				code: '<input type="range" min="0" max="40" value="20">\n<input type="color" value="#4a90e2">'
			},
			{
				id: "search",
				title: "Search row and results",
				sel: ".search-row · .result",
				desc: "A box with a button beside it (the box takes the room), and under it a stack of full-width results to pick from. The location search uses it.",
				demo: '<div class="search-row"><input type="text" placeholder="Search a place" aria-label="Search a place"><button class="glass" type="button">Search</button></div><button class="result" type="button">Regina, Saskatchewan</button><button class="result" type="button">Dhaka, Bangladesh</button>',
				code: '<div class="search-row">\n\t<input type="text"><button class="glass">Search</button>\n</div>\n<button class="result">A result</button>'
			},
			{
				id: "place-matches",
				base: "search",
				title: "Place search matches",
				sel: ".place-anchor > .place-float · .place-note · .place-credit · .place-empty",
				desc: "The matches of a place search, floating over the page under its search row, or over it when there's more room above (the script says where and how tall: <code>--float-top</code>, <code>--float-bottom</code>, <code>--float-max</code>). Mostly solid, since it covers other boxes' words. Under the matches, a quiet line or two: a note (<b>.place-note</b>), where they came from (<b>.place-credit</b>), or that there were none (<b>.place-empty</b>).",
				demo: `<div class="place-anchor" style="max-width:24em;height:9em"><div class="search-row"><input type="text" value="Regina"><button class="glass medium">Search</button></div><div class="place-float" style="--float-top:3.5em"><button class="result" type="button">Regina, Saskatchewan</button><p class="place-credit">From Nominatim</p></div></div>`,
				code: "<div class=\"place-anchor\">\n\t<div class=\"search-row\">…</div>\n\t<div class=\"place-float\">\n\t\t<button class=\"result\">…</button>\n\t\t<p class=\"place-credit\">From Nominatim</p>\n\t</div>\n</div>"
			},
			{
				id: "font-search",
				title: "Font search box",
				sel: ".font-search",
				desc: "The search box at the top of the font picker: a plain outlined box rather than a glass one, with the list of fonts right under it.",
				demo: `<input class="font-search" placeholder="Search Google Fonts..." style="max-width:26em">`,
				code: "<input class=\"font-search\" placeholder=\"Search Google Fonts...\">"
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
				id: "update-progress",
				title: "Update progress",
				sel: ".update-progress (+ .working, .good, .bad) > .update-progress-dot · .lede.update-ready",
				desc: "While an update is installed: one line saying what's happening, a quieter one under it saying what to expect, and a dot that pulses while something is still going on (<b>.working</b>), green when it's done (<b>.good</b>), red when it isn't (<b>.bad</b>). <b>.update-ready</b> is the line saying a version is available, in the full text colour.",
				demo: `<div class="update-progress working" style="max-width:28em;margin:0"><span class="update-progress-dot"></span><div><strong>Downloading 2.0.1</strong><span class="hint">This takes a minute or two.</span></div></div>`,
				code: "<div class=\"update-progress working\" aria-live=\"polite\">\n\t<span class=\"update-progress-dot\"></span>\n\t<div><strong>…</strong><span class=\"hint\">…</span></div>\n</div>"
			},
			{
				id: "place-warning",
				title: "Warning in a box",
				sel: ".place-warning",
				desc: "A note in a quiet well that something won't work as it reads: Place search, when the Primary needs a key with none saved.",
				demo: `<p class="place-warning" style="max-width:28em">GeoNames has no key saved, so every search goes straight to Nominatim.</p>`,
				code: "<p class=\"place-warning\" hidden>…</p>"
			},
			{
				id: "spinner",
				title: "Spinner",
				sel: ".spinner",
				desc: "A small spinning ring before words that say something is under way (\"Looking for networks…\"). It slows right down when reduced motion is asked for, so it still says \"working\" without moving much.",
				demo: '<p class="status"><span class="spinner" aria-hidden="true"></span>Looking for networks…</p>',
				code: '<p class="status"><span class="spinner" aria-hidden="true"></span>Looking for networks…</p>'
			},
			{
				id: "secret",
				title: "Something to copy exactly",
				sel: ".secret",
				desc: "Text to read out or copy exactly, like a Wi-Fi password shown on request: in a fixed-width font, centred, and selected whole with one tap.",
				demo: '<p class="secret">a-very-long-home-password</p>',
				code: '<p class="secret">…</p>'
			},
			{
				id: "badge",
				title: "Badge",
				sel: ".badge",
				desc: "A small outlined label next to a word, such as “dev” after a development build's version. It says something about its neighbour; it isn't a button and doesn't react. (One that does is <b>.badge-button</b>: see Auto, and a slider it leaves alone.)",
				demo: '<span style="font-size:1.4em">1.19.4 <span class="badge">dev</span></span>',
				code: '1.19.4 <span class="badge">dev</span>\n\nversionHtml()\t// writes this for you'
			},
			{
				id: "info-tip",
				title: "Hint behind an ⓘ",
				sel: ".info-tip > .info-bubble",
				desc: "For a hint too long to sit on the page (what files a background can be, say): an ⓘ that shows the hint in a small bubble after the pointer rests on it for half a second, at once when it's reached with the keyboard, or with a tap on a touch screen. The box it's in is lifted above its neighbours while the bubble shows. Written by infoTip(text, label), which escapes the text; label is what a screen reader calls the icon.",
				stage: 170,
				demo: '<span style="font-size:1.05em;font-weight:600">Background</span> <span class="info-tip" tabindex="0" role="button" aria-label="What can be used"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg><span class="info-bubble" role="tooltip">A picture, a GIF or a video, up to 50 MB.</span></span>',
				code: 'infoTip("A picture, a GIF or a video, up to 50 MB.", "What can be used")'
			}
		]
	},
	{
		id: "marketplace",
		title: "Marketplace",
		intro: "The Marketplace's own elements: its pages, a listing, tags, a listing's own page, the Sources page and the warning before a third-party source is added.",
		entries: [
			{
				id: "market-page",
				title: "Marketplace page",
				sel: ".market (+ .reading) > .market-head (+ .has-banner > .market-banner) · .market-toolbar · .market-section",
				desc: "Every Marketplace page: a column of boxes, wider than Settings' so the listings get up to three columns (<b>.reading</b> for a page that's mostly words). <b>.market-head</b> is the title and a line or two on the left and the page's one button on the right; with the registry's banner behind it (<b>.has-banner</b>) it's darkened towards the bottom so the words stay readable. <b>.market-toolbar</b> (the search, Modules and Themes) stays at the top while the listings scroll under it, never blurred less than 16px. <b>.market-section</b> is a heading between groups of listings.",
				demo: `<div class="market"><div class="segment market-head"><div><h1>Marketplace</h1><p class="lede">Modules and themes reviewed into the registry.</p></div><button class="glass market-action">Sources</button></div></div>`,
				code: "<div class=\"market\">\n\t<div class=\"segment market-head\">\n\t\t<div><h1>Marketplace</h1><p class=\"lede\">…</p></div>\n\t\t<a class=\"glass market-action\" href=\"/marketplace/sources\">Sources</a>\n\t</div>\n\t<div class=\"segment market-toolbar\">…</div>\n\t…\n</div>"
			},
			{
				id: "market-listing",
				base: "segment-clickable",
				title: "Listing",
				sel: ".market-list > .market-item > .market-link · .market-icon (+ .big), .market-initial · .market-item-text (h3, .market-by, .market-desc, .market-tags) · .market-action",
				desc: "One module or theme: its icon (its own picture, or a tile in a colour of its own with its first letter, <b>.market-initial</b>, its hue <code>--hue</code>), its name, who made it and what it does, tags under that, and its button. The whole box is a link to its page (<b>.market-link</b>, stretched over it) except the button, which sits above. As many columns as fit, each at least 30em. <b>.big</b> is the icon on a listing's own page.",
				demo: `<div class="market-list" style="max-width:34em"><div class="segment clickable market-item"><a class="market-link" href="#market-listing" aria-label="Weather"></a><span class="market-icon market-initial" style="--hue:95" aria-hidden="true">W</span><div class="market-item-text"><h3>Weather</h3><div class="market-by">by tanzim2000</div><div class="market-desc">Current conditions from Open-Meteo</div><div class="market-tags"><span class="provides-tag">OmniCore 1.0.0 or newer</span></div></div><button class="glass market-action">Install</button></div></div>`,
				code: "<div class=\"segment clickable market-item\">\n\t<a class=\"market-link\" href=\"/marketplace/modules/weather\" aria-label=\"Weather\"></a>\n\t<span class=\"market-icon market-initial\" style=\"--hue:95\">W</span>\n\t<div class=\"market-item-text\"><h3>Weather</h3><div class=\"market-by\">…</div><div class=\"market-desc\">…</div></div>\n\t<button class=\"glass market-action\">Install</button>\n</div>"
			},
			{
				id: "provides-tag",
				title: "Tag",
				sel: ".provides-tag (+ .warn)",
				desc: "A small outlined tag: what a listing does beyond its tile (runs in the background, takes input) and the OmniCore it needs. <b>.warn</b>, in the danger colour, is a need this OmniCore doesn't meet.",
				demo: `<span class="provides-tag">Runs in the background</span><span class="provides-tag warn">OmniCore 9.0.0 or newer</span>`,
				code: "<span class=\"provides-tag\">Runs in the background</span>\n<span class=\"provides-tag warn\">OmniCore 9.0.0 or newer</span>"
			},
			{
				id: "market-detail",
				title: "A listing's own page",
				sel: ".market-about · .market-traits (li.warn) · .market-shots (figure, img, figcaption) · .market-url",
				desc: "What a listing's page adds: its whole description in paragraphs (<b>.market-about</b>), what it does in plain sentences (<b>.market-traits</b>, a need not met in the danger colour), its screenshots in a grid (<b>.market-shots</b>), and a web address that wraps anywhere on a phone (<b>.market-url</b>).",
				demo: `<div class="segment" style="max-width:30em"><h2>Good to know</h2><ul class="market-traits"><li>Keeps running the whole time OmniCore is on.</li><li class="warn">Works on OmniCore 9.0.0 or newer.</li></ul></div>`,
				code: "<div class=\"segment market-about\"><p>…</p></div>\n<ul class=\"market-traits\"><li>…</li><li class=\"warn\">…</li></ul>"
			},
			{
				id: "market-source",
				title: "Source row",
				sel: ".market-source > .market-source-name > .market-source-banner",
				desc: "One registry on the Sources page: its banner, small, beside its name and address, and its button at the end, with a thin line between one and the next.",
				demo: `<div class="segment" style="max-width:32em"><div class="market-source"><div class="market-source-name"><span class="market-source-banner" style="background:linear-gradient(135deg,#3a6073,#16222a)"></span><div><strong>Omnia Registry</strong><div class="hint">Built in</div></div></div></div></div>`,
				code: "<div class=\"market-source\">\n\t<div class=\"market-source-name\"><img class=\"market-source-banner\" src=\"…\" alt=\"\"><div>…</div></div>\n\t<button class=\"glass market-action\">Remove</button>\n</div>"
			},
			{
				id: "market-error",
				base: "segment",
				title: "Registry error",
				sel: ".market-error",
				desc: "The registry couldn't be read: what went wrong and a way to try again, in a box edged in the danger colour.",
				demo: `<div class="segment market-error" style="max-width:32em"><div><h2>Couldn't reach the registry</h2><p class="lede">Connection timed out.</p></div><button class="glass market-action">Try again</button></div>`,
				code: "<div class=\"segment market-error\">\n\t<div><h2>Couldn't reach the registry</h2><p class=\"lede\">…</p></div>\n\t<a class=\"glass market-action\" href=\"\">Try again</a>\n</div>"
			},
			{
				id: "market-warning",
				title: "Third-party warning",
				sel: ".market-warning > h3, p · .market-warning-actions",
				desc: "Shown once, right before a source OmniCore hasn't reviewed is added: on purpose not like anything else on the page, since it's the one moment worth standing out. Its two buttons (<b>.market-warning-actions</b>) are Go back and I understand.",
				demo: `<div class="market-warning" style="max-width:32em"><h3>This adds a source OmniCore hasn't reviewed</h3><p>A module is a full, unrestricted Node program.</p><div class="market-warning-actions"><button type="button" class="btn-glossy btn-glossy-green">Go back</button><button type="button" class="btn-glossy btn-glossy-neutral">I understand</button></div></div>`,
				code: "<div class=\"market-warning\" hidden>\n\t<h3>…</h3>\n\t<p>…</p>\n\t<div class=\"market-warning-actions\">…</div>\n</div>"
			}
		]
	},
	{
		id: "layouts",
		title: "Page layouts",
		intro: "The shapes a whole page can take. So far one: the Settings home, a page of tabs under a notch. Its script (<code>core/settings-home.js</code>) moves things and measures them, and only ever switches classes and sets CSS variables; every look is in <code>core/ui-theme.js</code>, like everything else.",
		entries: [
			{
				id: "tabbed-page",
				title: "Page of tabs",
				sel: "body.settings-home > .home-head · .home-panes > .home-track > .home-pane (.pane-title) · html.home-tabs",
				desc: "The Settings home: a heading at the top, and the tabs side by side on one strip that scrolls sideways, never up and down, each at least a screen wide. The script marks the page <b>html.home-tabs</b> before it's drawn, so it opens on the right tab without moving; without the script it's one long page, each tab under its <b>.pane-title</b>. A picture behind the page pans along as the strip moves (<code>--pan</code>, 0 to 1). On a phone held upright each tab scrolls up and down on its own, under the heading, and a swipe moves a whole tab.",
				demo: `<header class="home-head" style="min-height:0;padding:0"><h1>Settings</h1></header><h2 class="pane-title" style="margin:0.5em 0 0">General</h2><p class="muted" style="margin:0.25em 0 0">Without the script, each tab's boxes come under its name, one tab after another.</p>`,
				code: '<body class="settings-home">\n\t<header class="home-head"><h1>Settings</h1></header>\n\t<nav class="notch">…</nav>\n\t<div class="home-panes"><div class="home-track">\n\t\t<section class="home-pane" data-pane="general">\n\t\t\t<h2 class="pane-title" id="general">General</h2>\n\t\t\t<div class="home-bento">…</div>\n\t\t</section>\n\t</div></div>\n</body>\n\n// or let settings-home.js write it:\nhomeHtml(panes, updateReady)',
				note: "The Back button keeps out of the way by itself: in the top left the heading starts after it, and on a phone held upright the sign-out button goes to the top right, since the capsule has the bottom."
			},
			{
				id: "settings-page",
				title: "Settings page",
				sel: "body.settings-page (+ .centered) > .settings-head · .bento (+ .narrow) > .bento-row (+ .two, .three, .top) · .bento-column",
				desc: "Every page of the admin face (port 3000) but the Settings home: a column of boxes down the middle of the screen, as wide as the screen allows and never too wide to read. <b>.settings-head</b> is its heading row. In the <b>.bento</b>, a <b>.bento-row</b> puts boxes side by side when the screen is wider than it is tall: <b>.two</b> (the first a little wider), <b>.three</b> even thirds, <b>.top</b> lined up at the top rather than stretched. A <b>.bento-column</b> stacks boxes inside one column of a row. <b>.narrow</b> is for a page that's one short form (signing in, Not found), and <b>body.centered</b> puts it in the middle of the screen. Links on a Settings page are plain words in the text colour, and a box's lede has room under it.",
				demo: `<div class="bento" style="max-width:36em"><div class="bento-row two"><div class="segment"><h2>Wider</h2><p class="hint">.bento-row.two</p></div><div class="segment"><h2>Narrower</h2></div></div><div class="segment"><h2>A whole row</h2></div></div>`,
				code: "<body class=\"settings-page\">\n\t<div class=\"settings-head\"><h1>Network</h1></div>\n\t<div class=\"bento\">\n\t\t<div class=\"bento-row two\">\n\t\t\t<div class=\"segment\">…</div>\n\t\t\t<div class=\"segment\">…</div>\n\t\t</div>\n\t</div>\n</body>\n\n// admin-face.js's page() writes the body and its class",
				note: "A row's boxes are as tall as the taller one. On a phone held upright every row is one column."
			},
			{
				id: "docked-page",
				base: "settings-page",
				title: "Docked page",
				sel: "body.docked (+ .back-br) · .page-dock · .dock-button",
				desc: "A Settings page that's exactly the window's height and never scrolls itself (a widget's page): its capsule of actions (<b>.page-dock</b>, a dock with the page's status line under it) is always at the bottom, and whatever is too long scrolls inside its own box. <b>.back-br</b> says the Back button is in the bottom right, so on a narrow screen the capsule leaves it room. A page whose only action is one button uses <b>.dock-button</b>: the capsule's place and width, a glass button's shape.",
				demo: `<div class="page-dock" style="margin:0"><div class="dock"><button>Save</button><button class="danger">Remove</button></div><p class="status good">Saved.</p></div>`,
				code: "<body class=\"settings-page docked\">\n\t<div class=\"bento\">…</div>\n\t<div class=\"page-dock\">\n\t\t<div class=\"dock\">…</div>\n\t\t<p class=\"status\" id=\"status\"></p>\n\t</div>\n</body>"
			},
			{
				id: "face-page",
				base: "settings-page",
				title: "A face's page",
				sel: ".face-columns · .resource-pair > .resources, .face-actions > .face-buttons · .note-segment",
				desc: "The parts of a face's page. <b>.face-columns</b>: two columns that end level, the last box in each taking up the difference. <b>.resource-pair</b>: Manage resources (<b>.resources</b>, its rows a little taller) beside This face (<b>.face-actions</b>, Open face and Delete face in <b>.face-buttons</b>, stacked and filling the box on a wide screen, side by side and first on a phone). <b>.note-segment</b>: the Notifications box, whose two previews fill its height.",
				demo: `<div class="settings-page"><div class="resource-pair" style="max-width:34em"><div class="segment resources"><h2>Manage resources</h2><a class="row glass" href="#face-page"><strong>Widgets</strong><span>1 widget</span></a></div><div class="segment face-actions"><div class="face-buttons"><button class="glass">Open face</button><button class="glass glass-danger">Delete face</button></div></div></div></div>`,
				code: "<div class=\"resource-pair\">\n\t<div class=\"segment resources\">…</div>\n\t<div class=\"segment face-actions\">\n\t\t<div class=\"face-buttons\"><button class=\"glass\">Open face</button>…</div>\n\t</div>\n</div>"
			},
			{
				id: "wizard-page",
				title: "Wizard page",
				sel: "body.wizard-page > .wizard-head · .wizard-content > .wizard-split, .wizard-single · .segment-head > .mini · .segment-scroll · .part",
				desc: "The wizard (port 3999): exactly the window's height, never scrolling itself, its step's heading at the top (<b>.wizard-head</b>) and the dock at the bottom. In between (<b>.wizard-content</b>), a step is either two boxes sharing the room (<b>.wizard-split</b>, side by side on a screen wider than it is tall, stacked on one taller than it is wide) or one box only as tall as its form (<b>.wizard-single</b>); whatever is too long scrolls inside its box (<b>.segment-scroll</b>). Its box headings are quieter than Settings' ones. <b>.segment-head</b> is a heading with a small button beside it (<b>.mini</b>, Download themes); <b>.part</b> is a later part of a box, a little apart from what's above it.",
				demo: `<div class="wizard-page"><div class="wizard-split" style="max-width:40em"><div class="segment"><div class="segment-head"><h2>Available modules</h2><button type="button" class="mini">Download modules</button></div><button type="button" class="flat">Weather<small>The weather where you are</small></button></div><div class="segment"><h2>On this face</h2><button type="button" class="picked removable">Weather<small>Weather · click to remove</small></button></div></div></div>`,
				code: "<body class=\"wizard-page\">\n\t<div class=\"wizard-head\" id=\"header\">…</div>\n\t<div class=\"wizard-content\" id=\"content\">\n\t\t<div class=\"wizard-split\">\n\t\t\t<div class=\"segment\">…</div>\n\t\t\t<div class=\"segment\">…</div>\n\t\t</div>\n\t</div>\n\t<div class=\"dock\">…</div>\n</body>"
			},
			{
				id: "welcome-page",
				title: "Welcome face",
				sel: "body.welcome-page > .segment · .segment.face-list > .face · .actions · .timer > .timer-lamp",
				desc: "The welcome face (port 4000). Its title and the line under it in a box of glass at the top (a plain <b>.segment</b>, like a widget's page), so they read against the glass over any background. Under it, the same width, a pane of glass of a fixed height with the dashboards to open, which scrolls when there are more than fit (<b>.segment.face-list</b>, each <b>.face</b> a clickable box with its address under its name). The buttons under that (<b>.actions</b>), the Settings button in the top-right corner, and in the bottom-left corner a small round lamp that empties as it counts down to opening the last dashboard (<b>.timer</b>, its share left <code>--remaining</code>, 1 to 0).",
				demo: `<div class="welcome-page"><div class="segment" style="margin-bottom:1em"><h1>Welcome!</h1><p class="lede">Choose your dashboard.</p></div><div class="segment face-list" style="height:12em"><div class="segment clickable face"><strong>Hallway</strong><span>Port 4001</span></div><div class="segment clickable face"><strong>Kitchen</strong><span>Port 4002</span></div></div></div>`,
				code: "<body class=\"welcome-page\">\n\t<div class=\"segment\"><h1>Welcome!</h1><p class=\"lede\">Choose your dashboard.</p></div>\n\t<div class=\"segment face-list\">\n\t\t<div class=\"segment clickable face\"><strong>Hallway</strong><span>…</span></div>\n\t</div>\n\t<div class=\"actions\">…</div>\n\t<div class=\"timer\"><div class=\"timer-lamp\" style=\"--remaining: 1\"></div></div>\n</body>"
			},
			{
				id: "centred-page",
				title: "Centred page",
				sel: "body.centred-page (+ .fallback-page, .inport-page) · .inport-page .controls",
				desc: "One short thing in the middle of the screen, its title over it. <b>.fallback-page</b>: a face with no theme yet, its themes to pick from, a little apart. <b>.inport-page</b>: an Inport's page, the controls a phone uses (<b>.controls</b>) under a smaller, quieter title, since the controls are the point, and with nothing to select by accident; also its list of controls to pick from, when a face has more than one.",
				demo: `<div class="inport-page" style="display:flex;flex-direction:column;align-items:center;gap:1em"><h1>Living room lights</h1><div class="controls"><button class="glass big">On</button><button class="glass big">Off</button></div></div>`,
				code: "<body class=\"centred-page inport-page\">\n\t<h1>Living room lights</h1>\n\t<div class=\"controls\">\n\t\t<button class=\"glass big\">On</button>\n\t</div>\n</body>"
			},
			{
				id: "notch",
				title: "Notch and capsule",
				sel: ".notch (+ .notch-up, .measuring) > .nb-pill (+ .ready, .keeping-up) · .nb (+ .show, .peek, [aria-current]) > .nl · .nb-dot",
				desc: "A black notch hanging from the top edge, shaped like a drop of water, with an icon for each tab (<b>.nb</b>). The picked tab (<code>aria-current</code>) has a piece of clear glass on it (<b>.nb-pill</b>), which slides from tab to tab once it's <b>.ready</b>. A tab's name (<b>.nl</b>) opens beside its icon on hover, keyboard focus or a long press (<b>.peek</b>), and the notch widens to make room. <b>.nb-dot</b> on About means an update is ready: green, with radar rings. <b>.notch-up</b> sends it up out of sight as the page fades out. On a phone held upright the same notch is a <b>capsule</b>: a narrow pill of frosted glass at the bottom, above the home bar, whose new tab's name opens (<b>.show</b>) for about a second.",
				stage: 110,
				demo: `<nav class="notch" aria-label="Settings sections"><span class="nb-pill ready" style="--pill-x:10px;--pill-w:2.75em" aria-hidden="true"></span><a class="nb" href="#notch" aria-current=\"page\" aria-label="General"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg><span class="nl" aria-hidden="true">General</span></a><a class="nb show" href="#notch" aria-label="Appearance"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg><span class="nl" aria-hidden="true">Appearance</span></a><a class="nb" href="#notch" aria-label="Resources"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/></svg><span class="nl" aria-hidden="true">Resources</span></a><a class="nb" href="#notch" aria-label="About"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r="0.7" fill="currentColor"/></svg><span class="nb-dot" aria-hidden="true"></span><span class="nl" aria-hidden="true">About</span></a></nav>`,
				code: 'notchHtml(updateReady)\n\n// The script puts the glass on the picked tab:\npill.style.setProperty("--pill-x", picked.offsetLeft + "px");\npill.style.setProperty("--pill-w", picked.offsetWidth + "px");',
				note: "The glass has no blur, so the icon under it stays sharp. <b>.measuring</b> and <b>.keeping-up</b> are the script's: for a moment, nothing moves while it measures, and the glass keeps up with its tab frame by frame while a name opens."
			},
			{
				id: "tab-grid",
				title: "Tab grid",
				sel: ".home-bento (+ .measuring) > .segment (.c2, .c3, .c4, .c6, .r2, .r3, .row1, .row2, .row3, .box-scroll, .float-open) · .home-bento .backdrop-preview",
				desc: "A tab's boxes, on six columns: <b>.c2</b>, <b>.c3</b> and <b>.c4</b> span that many, <b>.c6</b> the whole width, <b>.r2</b> two rows. On a tab, the grid goes sideways: two rows that fit the screen's height (<b>.row1</b>, <b>.row2</b> say which a box is on, and every box on the second reaches the bottom, so a tab ends level), and columns that go on to the right, so more boxes make the tab wider, not taller. The script shares the height out fairly between the rows (<code>--rows</code>), and a box with more in it than its place holds scrolls inside itself (<b>.box-scroll</b>), unless a search list is open in it (<b>.float-open</b>). A tab can have a third row (<b>.row3</b>, General's): the first two as tall as their boxes need, the third the rest, with <b>.r3</b> for a box three rows tall; on a screen too short for it, its empty boxes (kept for what's coming) step aside, and they're never drawn on a phone. A background preview in it is a strip. On a phone held upright it's one column.",
				demo: `<div class="home-bento" style="max-width:40em"><div class="segment c4"><h2>c4</h2></div><div class="segment c2"><h2>c2</h2></div><div class="segment c2"><h2>c2</h2></div><div class="segment c2"><h2>c2</h2></div><div class="segment c2"><h2>c2</h2></div></div>`,
				code: '<div class="home-bento">\n\t<div class="segment c4 row1">…</div>\n\t<div class="segment c2 r2">…</div>\n\t<div class="segment c2 row2">…</div>\n</div>'
			},
			{
				id: "lending-room",
				base: "tab-grid",
				title: "Lending room",
				sel: ".lends-room · .borrows-room",
				desc: "Two boxes side by side in a tab grid, where the first has empty room at its end: it gets narrower (<b>.lends-room</b>) and the one after it starts that much further left (<b>.borrows-room</b>), so the gap between them stays the same. A share of the box, never more than 5em. The Appearance tab's saving box gives the Typography box room for its note on one line and Font colour beside the font. Only where the boxes sit side by side.",
				demo: `<div class="home-bento" style="max-width:40em"><div class="segment c3 lends-room"><h2>Lends</h2></div><div class="segment c3 borrows-room"><h2>Borrows</h2></div></div>`,
				code: '<div class="segment c3 row2 lends-room">…</div>\n<div class="segment c3 row2 borrows-room">…</div>'
			}
		]
	},
	{
		id: "overlays",
		title: "Overlays",
		intro: "Drawn on top of every page OmniCore serves, a theme's page too. A theme's page doesn't load the Default UI (it's the theme's own page), so each of these is sent with its own styles, through <code>styleTag()</code>. They're still the central theme's elements: their look is in <code>core/ui-theme.js</code> and changes there and nowhere else. The scripts that bring them up (<code>core/network-status.js</code>, <code>core/notifications.js</code>) only switch classes, set <code>hidden</code>, and set CSS variables.",
		entries: [
			{
				id: "status-drawer",
				title: "Status drawer",
				sel: ".omni-net-drawer > .omni-net-pane (.omni-net-dim, .omni-net-speeds, .omni-net-hidden-text)",
				desc: "A clear pane of glass that comes out of the top-right corner, with no buttons, letting every touch through. It shows the Wi-Fi logo with a question mark on every face while the Wi-Fi is connected but the internet isn't there, and the Wi-Fi logo with its signal and live speeds on a dashboard face for ten seconds when the Wi-Fi comes back. <b>.omni-net-dim</b> fades the parts of the logo that aren't lit; <b>.omni-net-hidden-text</b> is the words a screen reader says.",
				stage: 120,
				demo: `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#3a6073,#16222a)"></div>
<div class="omni-net-drawer"><div class="omni-net-pane" style="--omni-net-at:translate(0,0)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path class="omni-net-b3" d="M2.5 9a14 14 0 0 1 19 0"/><path class="omni-net-b2" d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path class="omni-net-b1" d="M8.7 15.4a5 5 0 0 1 6.6 0"/><circle class="omni-net-b0" cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></svg><span class="omni-net-speeds"><span>↓ 4.2 MB/s</span><span>↑ 860 KB/s</span></span><span class="omni-net-hidden-text">Wi-Fi connected</span></div></div>`,
				code: '// Drawn by the script in core/network-status.js, on every page:\npane.style.setProperty("--omni-net-at", "translate(0, 0)");',
				note: "The pane rests wherever <code>--omni-net-at</code> says (a transform), and the script moves it between those places with an animation; it never sets a look of its own. A face's theme can hide the drawer (<code>.omni-net-drawer { display: none }</code>), never the takeover."
			},
			{
				id: "takeover",
				title: "Takeover",
				sel: ".omni-net-takeover (+ .on) > .omni-net-takeover-card (.omni-net-setup)",
				desc: "When the Wi-Fi is disconnected, this covers every face, pauses it, and says so. Under the words, Manual Setup in a frame (<b>.omni-net-setup</b>) from the admin face's port, so a theme's script on the page can't read a password typed into it. It's added hidden and fades in with <b>.on</b>; nothing can hide it.",
				stage: 320,
				demo: `<div class="omni-net-takeover on"><div class="omni-net-takeover-card"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 3l18 18" stroke-width="2.2"/><path class="omni-net-b3" d="M2.5 9a14 14 0 0 1 19 0"/><path class="omni-net-b2" d="M5.5 12.2a9.5 9.5 0 0 1 13 0"/><path class="omni-net-b1" d="M8.7 15.4a5 5 0 0 1 6.6 0"/><circle class="omni-net-b0" cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></svg><h1>Wi-Fi disconnected</h1><p>OmniCore lost its Wi-Fi and has paused everything until it's back. It keeps trying to reconnect on its own.</p></div></div>`,
				code: '<div class="omni-net-takeover on" role="alertdialog">\n\t<div class="omni-net-takeover-card">\n\t\t<svg>…</svg>\n\t\t<h1>Wi-Fi disconnected</h1>\n\t\t<p>…</p>\n\t\t<iframe class="omni-net-setup" title="Manual Setup"></iframe>\n\t</div>\n</div>'
			},
			{
				id: "notification",
				title: "Notification",
				sel: ".omni-note-layer (+ .is-open, .is-closing, .has-link) > .omni-note-bento (.omni-note-source, .omni-note-source-icon, .omni-note-row, .omni-note, .omni-note-main, .omni-note-title, .omni-note-description (+ .is-alone), .omni-md-subtitle, .omni-md-table-more, .omni-note-skipped, .omni-note-links, .omni-note-link, .omni-note-qr, .omni-note-link-url) · .omni-note-timer > .omni-note-lamp",
				desc: "A message from a module, over whatever the face shows: frosted glass boxes over a blurred screen. Where it came from on top, then the title and the message, and a QR code beside it for each link (<b>.has-link</b>), under it on a screen taller than it is wide. The round timer in the corner (<b>.omni-note-lamp</b>) empties as its time runs out, from <code>--remaining</code>: 1 (full) to 0. <b>.is-open</b> brings it in and <b>.is-closing</b> takes it away. Its glass is light or dark as the face's Notifications setting says, and its font and size are the ones chosen in Settings.",
				stage: 360,
				demo: `<div style="position:absolute;inset:0;background:linear-gradient(135deg,#5b4636,#1d2b3a)"></div>
<div class="omni-note-layer is-open"><div class="omni-note-bento"><div class="omni-note omni-note-source"><span class="omni-note-source-icon"></span><span class="omni-note-source-name">Weather</span></div><div class="omni-note-row"><div class="omni-note omni-note-main"><h2 class="omni-note-title">Rain in an hour</h2><div class="omni-note-description"><p>Bring the washing in. It should clear by the evening.</p></div><p class="omni-note-skipped" hidden></p></div><div class="omni-note-links"></div></div></div><div class="omni-note-timer"><div class="omni-note-lamp" style="--remaining:0.6"></div></div></div>`,
				code: '// Shown by the script in core/notifications.js. A module only says\n// what (see Building modules.md):\nomni.notify({ title: "Rain in an hour", description: "Bring the washing in." });',
				note: "A theme's own rules can't reach inside: the layer puts its font and colour back on everything in it, and <code>hidden</code> always hides there."
			}
		]
	}
];

// The functions and scripts ui-theme.js hands to the pages that use it
const helpers = [
	["uiStyles({ forceSet })", "The whole stylesheet as text, for a page's <style> tag. Its colours are the font colour's set: white text, the dark set; black text, the light set (Beige Cream on the Default background). forceSet \"dark\" or \"light\" wins (the docs site, Manual Setup)."],
	["colourSet()", "Which set the pages have now, \"dark\" (white text) or \"light\" (black text), from the font colour. The About face follows it with its own colours."],
	["backButton(href)", "The floating Back button, in the corner chosen in Settings. Nothing at all when href is empty: the welcome face, input faces and the wizard have nowhere to go back to."],
	["passwordField(inputHtml)", "Wraps a password box with its Show / Hide button."],
	["versionHtml()", "The version as a page shows it: “1.19.4”, with a dev badge after it on a development build."],
	["fontStack(settings) · fontFace(settings)", "The font list for CSS, and the @font-face rule for a downloaded font (served at /ui-font.woff2?v=…). Nothing for the system font."],
	["PASSWORD_TOGGLE_SCRIPT", "One listener for the whole page that makes every Show / Hide button work."],
	["PALETTES · SYSTEM_FONT", "The two colour tables (\"dark\" for white text, \"light\" for black text) and the system font list."],
	["styleTag(css)", "A <style> element holding some of the central theme's CSS. The one way a page gets one: no other file in core/ writes a <style>."],
	["CURTAIN_CSS · curtainStyles()", "The page fade's look (already part of uiStyles), and the same with its colour for a page without uiStyles: Beige Cream with black text on the Default background, black otherwise."],
	["STATUS_CSS · notificationStyles(mode)", "The overlays' looks (Overlays, above): the status drawer and the takeover, and notifications in \"light\" or dark glass."]
];

// Things people look for in ui-theme.js that are really somewhere else
const elsewhere = [
	[".page-dock", "Centres the Save | Remove capsule on a module's page. In core/admin-face.js; the capsule itself is .dock, from ui-theme.js."],
	[".mode-screen-split · .narrow-previews", "The layout of the Appearance tile. In core/admin-face.js."],
	["The Settings grid and its tiles", "Page layout in core/admin-face.js, built out of segments."],
	["The wizard's layout", "core/wizard-face.js. It uses .dock, .segment and .field from here."],
	["Dashboards", "Not the Default UI at all: a dashboard face belongs to its theme. What OmniCore draws on top of one (notifications, the status drawer, the takeover) is the central theme's: see Overlays."]
];

module.exports = { paletteNotes, paletteGroups, sections, helpers, elsewhere };
