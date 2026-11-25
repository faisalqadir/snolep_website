# Snolep Technologies website

Live at **https://faisalqadir.github.io/snolep_website/** (GitHub Pages, from the `gh-pages` branch).

One static page: `index.html`, `js/` and the pictures in `img/`. No build step and no libraries.

- **Dots** (`js/dots.js`): one canvas. Every dot is snow when no shape holds it (three depths, falling and drifting; 38% of the dots never join a shape, so it always snows; the fall gets heavier over the mountain and the closing section (`density` in `index.html`); falling snow parts around the mouse pointer or a finger and is swept along in its wake, then drifts back into its fall). The logo's snow leopard gathers from dots on load, blows away as snow when the page scrolls, and ends as the company name in the footer. Each form is pinned to an element and the page says how present it is from the scroll, so nothing lags. With reduced motion the logo stays a plain picture.
- **Guiding Principles** (`#values`): on a desktop (1024 px wide and 640 px tall or more) the section is a scroll sequence: its stage stays on screen (the title, the current principle with its progress bar, and a wide frame below) while the four principles play one after another, each animation scrubbed by its quarter of the scroll (the `.v-stage` markup and the script under "Values and standards, live"). On phones, tablets, short screens and with reduced motion it stays the static version: the peak beside the four rows. The site as it was before the sequence is kept on the `static` branch of the snolep_website repo.
- **What we build**: six kinds of work, each a `.card` in `#work` with the project behind it. Screenshots are whole pages (`img/work-*.webp`, 1152 px wide) that scroll through their frame on hover. Cards still waiting for a visual have a `.shot.plate` with a `<!-- visual to come -->` comment: replace that div with `<div class="shot"><img src="./img/work-NAME.webp" ...></div>`.
- **Contact**: the form posts to FormSubmit, which emails the address set in `LEADS` in `index.html`.
- **Navigation**: on wide screens a top bar (the name, Values, What we build, Inspiration, Start a project); under 1100px the Menu button opens the side panel with the index, work links and the clock.

Preview locally with `python3 -m http.server` in this folder.
