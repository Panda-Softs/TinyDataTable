(function () {

    const _isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
// Keep e   xisting renderers and add new ones (new render API: render({ value, row, index, ctx }))
    const _badges = (value, ctx, classFct) => {
        const items = String(value).split(',').map(s => s.trim()).filter(Boolean);
        const badgeClass = (typeof classFct === 'function') ? (classFct(value) || '') : '';
        return items.map(s => `<span class="badge${badgeClass}">${ctx._esc(s)}</span>`).join('');
    }

    TinyDataTable.appendTypeRenderers({
        // String: capitalize via global str.capitalize()
        capitalize({value, ctx}) {
            if (ctx._blank(value)) return '';
            const s = String(value).trim();
            return ctx.phase === 'display' ? s?.capitalize() : s;
        },

        // Phone: format via global phone_format(data, true)
        phone({value, row, ctx}) {
            if (ctx._blank(value)) return '';

            const s = String(value).trim();
            if (ctx.phase !== 'display') return s;

            let formatted = phone_format(s, true);

            if (!_isMobile) {
                // Normalize number for tel:
                const tel = s.replace(/[^\d+]/g, '');

                // Build title only from non-empty name parts
                const nameParts = [row?.lastname, row?.firstname].map(v => v && String(v).trim()).filter(Boolean);

                const title = nameParts.length ? `Call to ${nameParts.join(' ')}` : 'Call';

                formatted = `<a href="tel:${tel}" class="phone-link" title="${ctx._esc(title)}">${formatted}</a>`;
            }

            return ctx._html(formatted);
        },

        // Email: HTML in display, raw string otherwise
        email({value, ctx}) {
            if (ctx._blank(value)) return '';
            const s = String(value).trim();
            return ctx.phase === 'display' ? ctx._html(`<a class="mailto" href="mailto:${ctx._esc(s)}">${ctx._esc(s)}</a>`) : s;
        },
        badges({value, ctx}) {
            if (ctx._blank(value)) return '';
            return ctx.phase == 'display' ? ctx._html(_badges(value, ctx)) : value;
        },
        badges_abo({value, ctx}) {
            if (ctx._blank(value)) return '';
            return ctx.phase == 'display' ? ctx._html(_badges(value, ctx, Renderer.subscription_color)) : value;
        }
    });

})();

