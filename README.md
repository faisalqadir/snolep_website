# Snolep Technologies website

Live at **https://faisalqadir.github.io/snolep_website/** (GitHub Pages, from the `gh-pages` branch).

One static page: `index.html`, `js/` and the pictures in `img/`. No build step and no libraries.

- **Dots** (`js/dots.js`): one canvas. Every dot is snow when no shape holds it (three depths, falling and drifting; 38% of the dots never join a shape, so it always snows). The logo's snow leopard gathers from dots on load, blows away as snow when the page scrolls, and ends as the company name in the footer. Each form is pinned to an element and the page says how present it is from the scroll, so nothing lags. With reduced motion the logo stays a plain picture.
- **Running leopard** (`js/leopard.js`, `js/leopard-frames.js`): seven poses from the drawn reference (`tools/leopard-reference.webp`: a standing pose and a six-frame gallop), the same 2,598 dots in every pose, matched so each dot glides from pose to pose, drawn as a loose stipple (`python3 tools/leopard-frames.py tools/leopard-reference.webp js/leopard-frames.js`, about two minutes). The story is told once: snow settles into the logo's leopard on load and falls away as the page moves; on the mountain (Inspiration) snow settles into the leopard on the summit, it gallops down the traced line (`RIDGE` in `index.html`) with the scroll, stands when the scroll stops, and leaps off the end, coming apart into snow mid-leap, while each of the four habits fills a thin line; at the bottom the snow settles into the name. Everything follows the scrollbar both ways, except the name, which settles on a timer once it is on screen.
- **What we build**: seven kinds of work, each a `.card` in `#work` with the project behind it. Screenshots are whole pages (`img/work-*.webp`, 1152 px wide) that scroll through their frame on hover. Cards still waiting for a visual have a `.shot.plate` with a `<!-- visual to come -->` comment: replace that div with `<div class="shot"><img src="./img/work-NAME.webp" ...></div>`.
- **Contact**: the form posts to FormSubmit, which emails the address set in `LEADS` in `index.html`.
- **Navigation**: on wide screens a top bar (the name, Values, What we build, Inspiration, Start a project); under 1100px the Menu button opens the side panel with the index, work links and the clock.

Preview locally with `python3 -m http.server` in this folder.
