TinyDataTable.defaults.texts = {
    // Empty table
    emptyMessage: "Aucune donnée disponible",

    // Search
    searchPlaceholder: "Rechercher…",

    // Pager – page size selector
    pagerShowPrefix: "Afficher ",
    pagerEntriesSuffix: " lignes",

    // Pager – info line
    pagerInfo: "Affichage de {start} à {end} sur {total}",

    // Pager – navigation buttons
    pagerPrev: { html: '<i class="material-icons">chevron_left</i>' },
    pagerNext: { html: '<i class="material-icons">chevron_right</i>' },
    pagerFirst: { html: '<i class="material-icons">first_page</i>' },
    pagerLast: { html: '<i class="material-icons">last_page</i>' },

    // Pager – ellipsis
    pagerEllipsis: "…",

    exportButton: {
        label: (fmt) => {
            const labels = {
                xlsx: 'Excel (.xlsx)',
                pdf: 'Document PDF',
                csv: 'Fichier CSV',
            };
            return labels[fmt];
        }
    }
};