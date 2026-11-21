// Puts the contributors from the footer in as few columns as possible, all with the same number of names
// and at most 5 each, when the footer is wide enough for them.
// The few names left over (fewer than the number of columns) go on one more row at the bottom, centered.
// For example, 17 names make 3 columns of 5 with the last 2 names centered under them, and 12 names make 3 columns of 4.
// When not that many columns fit (on small screens), it uses only as many as fit, so the columns get longer.
(() => {
    const list = document.querySelector('.contributors-list');
    const footer = list && list.closest('.footer');
    if (!footer) return;

    const names = Array.from(list.children);
    const maxNamesPerColumn = 5;
    const minSideTextWidth = 260; // the texts on the left and right of the list need at least this much room

    function textWidth(element) {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect().width;
    }

    function layOut() {
        const footerStyle = getComputedStyle(footer);
        // not clientWidth, because it rounds the width and the math can be off by a pixel on zoomed screens
        const footerWidth = footer.getBoundingClientRect().width - parseFloat(footerStyle.paddingLeft) - parseFloat(footerStyle.paddingRight);
        const gap = parseFloat(getComputedStyle(list).columnGap) || 0;

        // measure the names as if each one were on a single line
        list.style.whiteSpace = 'nowrap';
        const nameWidth = Math.max(0, ...names.map(textWidth));
        list.style.whiteSpace = '';

        // as few columns as possible with max 5 names each (the names left over go on the extra row and don't count),
        // but no more than fit in the footer (if fewer columns fit, each one gets more than 5 names;
        // the -1 leaves one pixel free, just to be safe)
        const wanted = Math.floor(names.length / (maxNamesPerColumn + 1)) + 1;
        const fitting = Math.max(1, Math.floor((footerWidth - 1 + gap) / (nameWidth + gap)));
        const columns = Math.min(wanted, fitting);
        const rows = Math.floor(names.length / columns);
        const full = columns * rows;
        const leftover = names.length - full;

        // each column takes 2 grid tracks, so a name can also be placed between two columns.
        // the names left over go side by side, centered under the columns. centering puts them right under
        // columns when the number of columns and the number of names left over are both even or both odd,
        // and between columns otherwise. when both are even and there is room (at least twice as many columns
        // as names left over), they are spaced out so they sit between columns instead. when both are odd, or both
        // are even without room, they stay right under columns, for example 1 name left over under 3 columns sits
        // under the middle column
        const spread = leftover % 2 === 0 && columns % 2 === 0 && columns >= leftover * 2;
        const step = spread ? 4 : 2;
        const firstLeftoverStart = columns - (leftover - 1) * step / 2;

        list.style.setProperty('--contributors-tracks', columns * 2);
        names.forEach((name, index) => {
            const inColumns = index < full;
            const start = inColumns ? Math.floor(index / rows) * 2 + 1 : firstLeftoverStart + (index - full) * step;
            name.style.gridColumn = start + ' / span 2';
            name.style.gridRow = String(inColumns ? index % rows + 1 : rows + 1);
        });
        list.dataset.laidOut = '';

        // if the texts don't have enough room next to the list, the footer parts go one under another
        const listWidth = columns * nameWidth + (columns - 1) * gap;
        const footerGap = parseFloat(footerStyle.columnGap) || 0;
        footer.toggleAttribute('data-stacked', footerWidth - listWidth - 2 * footerGap < 2 * minSideTextWidth);
    }

    layOut();
    // run it again after the font loads, because the font changes how wide the names are
    if (document.fonts) document.fonts.ready.then(layOut);

    // run it again when the footer or the list changes size: when the window is resized, and also when only the
    // text is zoomed, which changes how wide the names are but not how wide the footer is.
    // if nothing that matters has changed, layOut gives the same result, so an extra run changes nothing
    if ('ResizeObserver' in window) {
        const observer = new ResizeObserver(() => requestAnimationFrame(layOut));
        observer.observe(footer);
        observer.observe(list);
    }
})();
