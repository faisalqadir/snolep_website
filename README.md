# Snolep Technologies website

Live at **https://faisalqadir.github.io/snolep_website/** (GitHub Pages, from the `gh-pages` branch).

One static page: `index.html`, `js/dots.js`, `js/leopard.js` and the pictures in `img/`. No build step and no libraries.

- **Dots** (`js/dots.js`): one canvas. The logo's snow leopard gathers from dots on load, blows away as snow when the page scrolls, and ends as the company name in the footer. Each form is pinned to an element and the page says how present it is from the scroll, so nothing lags. With reduced motion the logo stays a plain picture.
- **Running leopard** (`js/leopard.js`): a side-view skeleton filled with a fine grid of dots (white coat, dark rosettes). It gathers on the summit in the Roots section, gallops down the ridge as the page scrolls (the path is the `ridge` points in `index.html`, as fractions of the mountain picture) and leaps into the name.
- **What we build**: seven kinds of work, each a `.card` in `#work` with the project behind it. Screenshots are whole pages (`img/work-*.webp`, 1152 px wide) that scroll through their frame on hover. Cards still waiting for a visual have a `.shot.plate` with a `<!-- visual to come -->` comment: replace that div with `<div class="shot"><img src="./img/work-NAME.webp" ...></div>`.
- **Contact**: the form posts to FormSubmit, which emails the address set in `LEADS` in `index.html`.
- **Rail**: the panel on the right (a drawer under 1100px) with the index, work links, clock and the main button.

Preview locally with `python3 -m http.server` in this folder.
