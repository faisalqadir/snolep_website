# Snolep Technologies website

Live at **https://faisalqadir.github.io/snolep_website/** (GitHub Pages, from the `gh-pages` branch).

One static page: `index.html`, `js/dots.js` and the pictures in `img/`. No build step and no libraries.

- **Dots** (`js/dots.js`): one canvas. The logo's snow leopard gathers from dots on load, blows away as snow when the page scrolls, settles again on a summit in the Roots section and ends as the company name in the footer. Each form is pinned to an element and the page says how present it is from the scroll, so nothing lags. With reduced motion the logo stays a plain picture.
- **Work**: screenshots in `img/work-*.webp` (1152×600). To add a project, copy a `.card` in `index.html` and add its link to the rail.
- **Contact**: the form copies a short brief and opens the Instagram chat (`ig.me/m/snolep.in`). Swap the link in `#send` for an email or WhatsApp address when there is one.
- **Rail**: the panel on the right (a drawer under 1100px) with the index, work links, clock and the main button.

Preview locally with `python3 -m http.server` in this folder.
