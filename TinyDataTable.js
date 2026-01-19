/*!
 * TinyDataTable - Version 1.3.2
 * Lightweight data table in plain JavaScript (no required dependencies).
 *
 * Features
 * - Local data mode: in-memory search, multi-sort, paging, filters.
 * - Ajax mode: server-side paging/filtering/sorting with AbortController safety.
 * - "Load once" Ajax mode: fetch once then behave like local mode.
 * - Optional: mark.js highlighting, tooltips via pluggable adapter (e.g., Tippy.js).
 * - Grouping: group headers + merged columns (rowspan).
 * - Child rows: expandable nested rows (optionally lazy-loaded).
 * - Row selection (with optional group selection).
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TinyDataTable = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function escapeHtml(s) {
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    function debounce(fn, delay, ctx) {
        let timer = null;
        return function (...args) {
            if (timer) clearTimeout(timer);
            const self = ctx || this;
            timer = setTimeout(() => {
                timer = null;
                fn.apply(self, args);
            }, delay);
        };
    }

    /**
     * Tokenize a string/array of class names into a de-duplicated array.
     * Accepts comma or whitespace separators.
     */
    function tokenize_str(v) {
        if (v == null) return [];
        v = Array.isArray(v) ? v.flat(Infinity).filter(Boolean) : String(v).split(/[\s,]+/);
        return [...new Set(v.map(x => String(x).trim()).filter(Boolean))];
    }

    function isBlank(s) { return  s == null || String(s).trim() === ''}

    function camelCase(s) {
        return String(s).toLowerCase().replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    }

    function _isNode(val) { return val && typeof val === 'object' && (val.nodeType === 1 || val.nodeType === 11); }
    function formatText (tpl, vars) {
        tpl = tpl == null ? "" : String(tpl);
        return tpl.replace(/\{(\w+)\}/g, function (_, key) {
            return (vars && vars[key] != null) ? String(vars[key]) : "";
        });
    };

    function to_digits (value, locale, precision = 2)  {
        var num = Number(value);
        if (Number.isNaN(num)) return value; // not a number, just return as is
        try {
            return num.toLocaleString(locale || 'en-US', {minimumFractionDigits: precision, maximumFractionDigits: precision});
        } catch (e) {
            return num.toFixed(precision); //// Fallback in case Intl/locale issues
        }
    }

    function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v) };

    function flattenParams(params) {
        const flatten = (obj, prefix = '') => {
            let items = [];
            for (let key in obj) {
                if (obj.hasOwnProperty(key)) {
                    const value = obj[key];
                    const newKey = prefix ? `${prefix}[${key}]` : key;

                    if (typeof value === 'object' && value !== null) {
                        items = items.concat(flatten(value, newKey)); // Recursively flatten nested objects
                    } else {
                        items.push([newKey, (value===undefined || value===null) ? '' : value]);
                    }
                }
            }
            return items;
        };
        return new URLSearchParams(flatten(params)).toString();
    }

    /**
     * Parse a fetch() Response expecting JSON.
     * - Handles non-2xx responses
     * - Handles HTML / non-JSON bodies
     * - Preserves response body snippet for debugging
     *
     * @param {Response} response
     * @param {string} url - Request URL (for error messages)
     * @returns {Promise<any>} Parsed JSON
     * @throws {Error} with extra fields: status, url, body
     */
    async function _dtParseJsonResponse(response, url) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const bodyText = await response.text();

        // HTTP error (4xx / 5xx)
        if (!response.ok) {
            const err = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
            err.status = response.status;
            err.statusText = response.statusText;
            err.url = url;
            err.body = bodyText.slice(0, 2000);
            throw err;
        }

        // Valid JSON response
        if (contentType.includes('application/json') || contentType.includes('+json')) {
            try {
                return JSON.parse(bodyText || 'null');
            } catch (e) {
                const err = new Error(`Invalid JSON response for ${url}`);
                err.cause = e;
                err.url = url;
                err.body = bodyText.slice(0, 2000);
                throw err;
            }
        }

        // Unexpected content-type (HTML, text, etc.)
        const err = new Error(`Expected JSON but got "${contentType || 'unknown'}" for ${url}`);
        err.url = url;
        err.body = bodyText.slice(0, 2000);
        throw err;
    }


    // Unified Ajax utility
    function _dtAjaxRequest(url, options = {}) {
        const method = (options.method || "GET").toUpperCase();
        let finalUrl = url;

        // Base request options
        const requestOptions = {
            method: method,
            headers: Object.assign({"X-Requested-With": "XMLHttpRequest"}, options.headers || {}),
            signal: options.signal
        };

        if (method === "GET") {
            // GET: params go into query string
            if (options.params) {
                let query = options.params;

                // Allow users to pass URLSearchParams directly
                if (query instanceof URLSearchParams) {
                    const usp = query;
                    finalUrl += (finalUrl.indexOf("?") !== -1 ? "&" : "?") + usp.toString();
                } else if (typeof query === "object") {
                    // Nested object → deep-flatten into bracketed keys
                    const flat = flattenParams(query);
                    finalUrl += (finalUrl.indexOf("?") !== -1 ? "&" : "?") + flat;
                } else if (typeof query === "string" && query.trim() !== "") {
                    // Already encoded query string
                    finalUrl += (finalUrl.indexOf("?") !== -1 ? "&" : "?") + query;
                }
            }
        } else {
            // Non-GET: JSON body
            requestOptions.headers["Content-Type"] =
                requestOptions.headers["Content-Type"] || "application/json";

            if (options.body !== undefined) {
                // Explicit body provided by caller
                requestOptions.body = options.body;
            } else if (options.params && typeof options.params === "object") {
                // No body, but params given → send as JSON
                requestOptions.body = JSON.stringify(options.params);
            } else {
                requestOptions.body = null;
            }
        }

        return fetch(finalUrl, requestOptions).then(r => _dtParseJsonResponse(r, finalUrl));
    }


    /**
     Delegate events: _addEventListener(root, 'click', 'tr[data-row]', handler)
     - attaches 1 listener to `root`
     - when event bubbles from an element matching `selector`, calls handler
     - inside handler: this === matched element
     - handler gets (e, matched) so you can use either `this` or `matched`
     */
     function _addEventListener(root, eventName, selector, handler, ctx, options) {
         if (!root || !eventName || !selector || typeof handler !== 'function') return null;

         const listener = function (e) {
             const target = e.target?.closest?.(selector);
             if (!target || !root.contains(target)) return;

             const evt = Object.create(null);

             ['type', 'bubbles', 'cancelable', 'defaultPrevented', 'eventPhase', 'isTrusted', 'timeStamp', 'shiftKey', 'ctrlKey', 'altKey', 'metaKey'].forEach(prop => {
                 Object.defineProperty(evt, prop, {
                     get() { return e[prop]; },
                     enumerable: true,
                     configurable: true
                 });
             });

             // Override or add properties
             evt.target = e.target;
             evt.currentTarget = target;
             evt.delegateTarget = root;
             evt.preventDefault = () => e.preventDefault();
             evt.stopPropagation = () => e.stopPropagation();
             evt.stopImmediatePropagation = () => e.stopImmediatePropagation();
             handler.call(ctx || target, evt, target);
         };

         root.addEventListener(eventName, listener, options);
         return () => root.removeEventListener(eventName, listener, options);
     }

     /**
     * Normalize defaultSort option into an array of { key, dir } objects.
     *
     * Supported forms:
     *   - { id: 'asc', date: 'desc' }
     *   - { 0: 'asc', 3: 'desc' } // by column index
     *
     * @param {any} defaultSort - user-provided defaultSort option
     * @param {Array} columns   - TinyDataTable columns array
     * @returns {Array<{key: string, dir: 'asc'|'desc'}>}
     */
    function _normalizeDefaultSort(defaultSort, columns) {
        var orders = [];

        if (!defaultSort || typeof defaultSort !== 'object' || Array.isArray(defaultSort)) {
            return orders;
        }

        Object.keys(defaultSort).forEach(function (k) {
            var rawDir = defaultSort[k];
            if (!rawDir) return;

            var dir = String(rawDir).toLowerCase() === 'desc' ? 'desc' : 'asc';
            var colKey = null;

            // Numeric key => treat as column index
            if (/^\d+$/.test(k)) {
                var idx = parseInt(k, 10);
                if (columns && columns[idx]) {
                    colKey = columns[idx].key;
                }
            } else {
                // String key => treat as column key
                colKey = k;
            }

            if (colKey) {
                orders.push({ key: colKey, dir: dir });
            }
        });

        return orders;
    }


    /**
     * Internal helper to create DOM elements with optional classes and attributes.
     *
     * @param {string} tagName - Tag name, e.g. 'div', 'span', 'button'.
     * @param {string|string[]|null} [classNames] - Optional classes (array or space/comma-separated string).
     * @param {Object} [attrs] - Optional attributes as key/value pairs.
     *   - Normal keys: assigned as properties if possible, otherwise via setAttribute.
     *   - Keys starting with "data-": mapped to element.dataset in camelCase.
     *   - Keys 'text', 'html' or 'style' are forbidden and will throw (set these manually).
     *
     * @returns {HTMLElement}
     */
    function _dtCreateElement(tagName, ...args) {
        const el = document.createElement(tagName);

        let classNames = null;   // string | string[] | null
        let attrs = null;        // object | null

        // Parse args:
        // ()                      -> no class, no attrs
        // (classNames)            -> class only
        // (attrs)                 -> attrs only (may include class)
        // (classNames, attrs)     -> class + attrs (attrs may include class to merge)
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (a == null) continue;

            if (isPlainObject(a)) {
                attrs = Object.assign(attrs || {}, a);
            } else {
                // treat as classNames
                classNames = classNames == null ? a : [classNames, a];
            }
        }

        // Merge class/className from attrs into classNames
        if (attrs) {
            const extraClass = attrs.class || attrs.className || null;
            if (extraClass != null) {
                delete attrs.class;
                delete attrs.className;
                classNames = classNames == null ? extraClass : [classNames, extraClass];
            }
        }

        // Normalize and apply classes
        _dtAddClass(el, classNames);

        // Apply attributes
        if (attrs) {
            Object.keys(attrs).forEach(function (name) {
                const value = attrs[name];
                if (value == null) return;

                if (name === 'html') { el.innerHTML = value; return; }
                if (name === 'text') { el.textContent = value; return; }

                if (name === 'style') {
                    el.style.cssText = value;
                    return;
                }

                if (name.indexOf('data-') === 0) {
                    const dataKey = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
                    el.dataset[dataKey] = value;
                    return;
                }

                if (name in el && name !== 'className') el[name] = value;
                else el.setAttribute(name, value);
            });
        }

        return el;
    }

    function _dtAddClass(el, classes) {
        if (!el || classes == null) return;
        if (typeof classes === 'function') classes = classes(el);
        if (typeof classes === 'string') classes = tokenize_str(classes);
        if (Array.isArray(classes)) {
            [...new Set(classes.filter(Boolean).map(t => t.trim()))].forEach(c => el.classList.add(c));
        }
    }

    // -----------------------------
    // Global namespace and CSS classes
    // -----------------------------

    const NAMESPACE = 'tiny-table';

    /**
     * TinyDataTable semantic version. Update when making breaking or notable changes.
     */
    const TINYDATATABLE_VERSION = '1.3.2';


    const TINY_TABLE_CLASSES = {
        // Root table class applied to the <table> element.
        root: NAMESPACE,

        // Wrapper around the table when scrollX/scrollY are enabled.
        wrapper: `${NAMESPACE}-wrapper`,

        // Single empty cell class used for colspan placeholder cells.
        emptyCell: `${NAMESPACE}-empty-cell`,

        // High-level layout containers (optional).
        // container  -> wraps controls + wrapper/table + pager when any of them exist.
        // controls   -> wraps the search input and filters bar.
        // search     -> wrapper for search input.
        // searchInput-> actual <input> element.
        // filters    -> wrapper for the filters bar.
        // filterItem -> individual filter element container.
        container: `${NAMESPACE}-container`,
        controls: `${NAMESPACE}-controls`,
        controlsActions: `${NAMESPACE}-controls-actions`,
        search: `${NAMESPACE}-search`,
        searchInput: `${NAMESPACE}-search-input`,
        searchLabel : `${NAMESPACE}-search-label`,
        filters: `${NAMESPACE}-filters`,
        filterItem: `${NAMESPACE}-filter-item`,

        // Sorting states used on <th> elements.
        sortedAsc: `${NAMESPACE}-sorted-asc`,
        sortedDesc: `${NAMESPACE}-sorted-desc`,

        // Parent/child rows for hierarchical data.
        rowHasChildren: `${NAMESPACE}-has-children`,
        childRow: `${NAMESPACE}-child-row`,

        // Toggle icon for expanding/collapsing child rows.
        toggleIcon: `${NAMESPACE}-toggle-icon`,

        // Pager / footer related classes.
        pager: `${NAMESPACE}-pager`,
        pagerInner: `${NAMESPACE}-pager-inner`,
        length: `${NAMESPACE}-length`,
        info: `${NAMESPACE}-info`,
        pages: `${NAMESPACE}-pages`,
        pagesSlot: `${NAMESPACE}-pages-slot`,
        pageButtonActive: `${NAMESPACE}-page-active`,
        ellipsis: `${NAMESPACE}-ellipsis`,

        // Grouping support.
        groupHeaderRow: `${NAMESPACE}-group-header-row`,
        groupHeaderCell: `${NAMESPACE}-group-header-cell`,

        // Row selection.
        selectHeaderCell: `${NAMESPACE}-select-header-cell`,
        selectCell: `${NAMESPACE}-select-cell`,

        loading: `${NAMESPACE}-loading`,
    };

    const COL_STYLE_PROPS = ['width', 'minWidth', 'maxWidth', 'textAlign', 'whiteSpace'];

    // -----------------------------
    // mark.js detection (once, inline)
    // -----------------------------

    let MARK_CTOR = (typeof window !== 'undefined' && window.Mark) ? window.Mark :
        (typeof globalThis !== 'undefined' && globalThis.Mark) ? globalThis.Mark :
            null;
    let GLOBAL_TOOLTIP_ADAPTER = null;

    // -----------------------------

    // -----------------------------
    // DataSource base and strategies
    // -----------------------------

    /**
     * Abstract base data source.
     * Concrete implementations must override load(state, columns).
     */
    class DataSource {
        constructor(table) {
            // table is the TinyDataTable instance (may be null for some sources)
            this.table = table || null;
        }

        /**
         * @param {Object} state  Table state (paging, search, sort, ...)
         * @param {Array} columns Column definitions
         * @returns {Promise<{rows: Array, total: number}>}
         */
        load(state, columns) {
            return Promise.reject(new Error('DataSource.load not implemented'));
        }
    }

    /**
     * LocalDataSource
     * Handles client-side data: search, sort, and paging in memory.
     */
    class LocalDataSource extends DataSource {
        constructor(data, table) {
            super(table);
            this.setData(data);
        }

        /**
         * Replace local data (LocalDataSource / AjaxLoadOnceDataSource) and re-draw.
         * @param {Array<Object>} data
         */

        setData(data) {
            this.original = Array.isArray(data) ? data.slice() : [];
            this._attachOriginalIndex();
        }

        // Attach a stable index to keep original ordering when no sort is applied
        _attachOriginalIndex() {
            this.original.forEach(function (row, idx) {
                if (Object.prototype.hasOwnProperty.call(row, '__dt_index')) return;
                Object.defineProperty(row, '__dt_index', {
                    value: idx,
                    enumerable: false,
                    configurable: false,
                    writable: false
                });
            });
        }

        /**
         * Return all rows after search + sort, without paging.
         */
        getFilteredRows(state, columns) {
            var searchableCols = columns.filter(function (c) {
                return c.searchable !== false;
            });

            var sortKey = state.sortKey;
            var sortableCol = null;

            if (sortKey) {
                sortableCol = columns.find(function (c) {
                    return c.sortable !== false && c.key === sortKey;
                });
            }

            var rows = this.original;
            var self = this;

            // Apply column filters (if configured and active) before search/sort.
            var activeFilters = state.filters || {};
            var hasActiveFilters =
                activeFilters &&
                typeof activeFilters === 'object' &&
                Object.keys(activeFilters).some(function (k) {
                    var v = activeFilters[k];
                    return v !== undefined && v !== null && v !== '' && v !== false;
                });

            if (hasActiveFilters && this.table && this.table.filters && this.table.filters.enabled) {
                var filterDefs = Array.isArray(this.table.filters.items)
                    ? this.table.filters.items
                    : [];

                rows = rows.filter(function (row) {
                    for (var key in activeFilters) {
                        if (!Object.prototype.hasOwnProperty.call(activeFilters, key)) continue;
                        var value = activeFilters[key];

                        // Resolve filter definition for this key (if any).
                        var def = filterDefs.find(function (f) {
                            return f && f.key === key;
                        });

                        // Disabled boolean or "empty" non-boolean values do not filter.
                        if (def && def.type === 'bool') {
                            if (!value) continue;
                        } else {
                            if (value === null || value === '' || value === undefined) continue;
                        }

                        // Custom predicate (full control).
                        if (def && typeof def.predicate === 'function') {
                            if (!def.predicate(row, value, {filter: def, table: self.table})) {
                                return false;
                            }
                            continue;
                        }

                        // Default behaviour:
                        //  - boolean filter: require truthy cell value
                        //  - other filters: strict string equality.
                        var cellValue = row[key];

                        if (def && def.type === 'bool') {
                            if (!cellValue) return false;
                        } else {
                            if (cellValue == null) return false;
                            if (String(cellValue) !== String(value)) return false;
                        }
                    }
                    return true;
                });
            }

            // Single helper for search + sort
            // 1) if real key and not synthetic → row[col.key]
            // 2) otherwise, if render exists → col.render(...)
            // 3) otherwise → null
            function getValue(col, row, phase) {
                let v = null;
                if (col.key && !col.isSyntheticKey) {
                    v = row[col.key];
                } else if (typeof col.render === 'function') {
                    try {
                        v = self.table._renderValue(col, v, row, 0, phase || "value", { isChild: false });
                    } catch (e) {
                        v = null;
                    }
                }

                return v;
            }

            // Search (parent rows + child rows if enabled)
            if (state.searchText && state.searchText.trim() !== '' && searchableCols.length > 0) {
                var q = state.searchText.toLowerCase();

                rows = rows.filter(function (row) {
                    // 1) Parent row match (uses getValue → key or render)
                    var parentMatch = searchableCols.some(function (col) {
                        var v = getValue(col, row, 'search');
                        if (v == null) return false;
                        return String(v).toLowerCase().indexOf(q) !== -1;
                    });
                    if (parentMatch) return true;

                    // 2) Child row match (unchanged, still key-based)
                    const table = self.table;
                    if (!table || !table.childRows || !table.childRows.enabled) return false;

                    var children = table._getChildrenForRow(row);
                    if (!children || !children.length) return false;

                    var childCols = table._getChildColumnsForParent(row) || [];
                    var childSearchableCols = childCols.filter(function (c) {
                        return c.searchable !== false && c.key;
                    });
                    if (!childSearchableCols.length) return false;

                    return children.some(function (child) {
                        return childSearchableCols.some(function (col) {
                            var vChild = child[col.key];
                            if (vChild == null) return false;
                            return String(vChild).toLowerCase().indexOf(q) !== -1;
                        });
                    });
                });
            }

            // Sort (based on state.sortOrders)
            var sortSpecs = [];

            if (Array.isArray(state.sortOrders) && state.sortOrders.length) {
                state.sortOrders.forEach(function (order) {
                    if (!order || !order.key) return;

                    var dirMult = (String(order.dir || order.direction || 'asc').toLowerCase() === 'desc') ? -1 : 1;
                    var col = columns.find(function (c) {
                        return c.sortable !== false && c.key === order.key;
                    });

                    if (col) {
                        sortSpecs.push({
                            col: col,
                            dir: dirMult
                        });
                    }
                });
            }

            if (sortSpecs.length) {
                // Precompute sort keys once per row (Schwartzian transform) for better performance
                var keyed = rows.map(function (row) {
                    var keys = sortSpecs.map(function (spec) {
                        var col = spec.col;
                        var v = getValue(col, row, 'sort');
                        if (v == null) return { t: 'n', v: null };
                        v = String(v).replace(/<[^>]*>/g, '');

                        // numeric
                        var n = Number(v);
                        if (!isNaN(n)) return { t: 'num', v: n };

                        // date
                        var d = Date.parse(v);
                        if (!isNaN(d)) return { t: 'date', v: d };

                        return { t: 'str', v: v };
                    });
                    return { row: row, keys: keys };
                });

                keyed.sort(function (a, b) {
                    for (var i = 0; i < sortSpecs.length; i++) {
                        var dir = sortSpecs[i].dir;
                        var ka = a.keys[i], kb = b.keys[i];

                        if (ka.v == null && kb.v == null) continue;
                        if (ka.v == null) return 1;
                        if (kb.v == null) return -1;

                        // Compare by type when both match; otherwise fallback to string
                        if (ka.t === kb.t) {
                            if (ka.t === 'num' || ka.t === 'date') {
                                var diff = ka.v - kb.v;
                                if (diff !== 0) return diff * dir;
                            } else {
                                var diffStr = String(ka.v).localeCompare(String(kb.v));
                                if (diffStr !== 0) return diffStr * dir;
                            }
                        } else {
                            var da = String(ka.v), db = String(kb.v);
                            var diffAny = da.localeCompare(db);
                            if (diffAny !== 0) return diffAny * dir;
                        }
                    }

                    // All sort keys equal → keep initial order
                    var ia = typeof a.row.__dt_index === 'number' ? a.row.__dt_index : 0;
                    var ib = typeof b.row.__dt_index === 'number' ? b.row.__dt_index : 0;
                    return ia - ib;
                });

                rows = keyed.map(function (x) { return x.row; });
            }


            return rows;
        }

        /**
         * Main load implementation in local mode: filtered rows + paging.
         */
        load(state, columns) {
            var rows = this.getFilteredRows(state, columns);
            var total = rows.length;

            // Paging
            if (state.pagingEnabled) {
                var start = (state.page - 1) * state.pageSize;
                var end = start + state.pageSize;
                rows = rows.slice(start, end);
            }

            return Promise.resolve({rows: rows, total: total});
        }
    }

    class AjaxLoadOnceDataSource extends LocalDataSource {
        constructor(ajaxOptions, table) {
            super([], table); //// Start with empty data; will be filled after first AJAX call
            this.ajax = ajaxOptions ?? {};
            this.fetchFn = typeof this.ajax.fetch === 'function' ? this.ajax.fetch : null;
            this._loaded = false;
        }

        /**
         * Force reload on next draw()
         */
        /**
         * Reload data and re-draw.
         * - Ajax mode: re-fetches the current page.
         * - Local/loadOnce mode: simply re-draws.
         */

        refresh() {
            this._loaded = false;
        }

        /**
         * First call: load from server, store in LocalDataSource, then use LocalDataSource.load()
         * Next calls: just use LocalDataSource.load() (search+sort+paging in memory)
         */
        load(state, columns) {
            const self = this;
            // Capture parent method once, correctly bound
            const _load = super.load.bind(this);

            // Already loaded -> use LocalDataSource behavior:
            // filtering + sorting + paging from your existing implementation
            if (this._loaded) {
                return _load(state, columns);
            }

            // ---- FIRST LOAD FROM SERVER ----

            // Custom ajax.fetch({state, columns}) hook
            if (this.fetchFn) {
                return Promise
                    .resolve(this.fetchFn({state: state, columns: columns}))
                    .then(function (result) {
                        self.setData(result);
                        self._loaded = true;
                        return _load(state, columns);
                    });
            }

            // Default fetch via fetch() using the same logic as AjaxDataSource
            var method = (this.ajax.method || 'GET').toUpperCase();
            var url = typeof this.ajax.url === 'function'
                ? this.ajax.url({state: state, columns: columns})
                : this.ajax.url;

            return _dtAjaxRequest(url, {
                method: method,
                headers: this.ajax.headers || {},
                signal: state.__signal
            }).then(function (json) {
                let rows = [];
                if (self.ajax.transform) {
                    rows = self.ajax.transform(json);
                } else {
                    rows = Array.isArray(json) ? json : (json.data || []);
                }
                self.setData(rows);
                self._loaded = true;
                // Now use the normal LocalDataSource logic (search + sort + paging)
                return _load(state, columns);
            });
        }
    }

    /**
     * AjaxDataSource
     * Handles server-side data loading.
     */
    class AjaxDataSource extends DataSource {
        constructor(ajaxOptions, table) {
            super(table);
            this.ajax = ajaxOptions ?? {};
            this.fetchFn = typeof this.ajax.fetch === 'function' ? this.ajax.fetch : null;

            if (!this.fetchFn && !this.ajax.url) {
                throw new Error('AjaxDataSource: either ajax.fetch or ajax.url is required');
            }
        }

        /**
         * Load data from the server.
         * Supports:
         *   - ajax.fetch({ state, columns }) -> { rows, total }
         *   - ajax.url + optional buildParams / transform
         */
        load(state, columns) {
            const self = this;
            const _handleFetchResponse = r => r.then(function (json) {
                if (typeof self.ajax.transform === 'function') {
                    json = self.ajax.transform(json);
                }
                const rows = Array.isArray(json) ? json : (json.data || []);
                const total = typeof json.total === 'number' ? json.total : rows.length;
                return {rows: rows, total: total};
            });

            if (this.fetchFn) {
                return _handleFetchResponse(Promise.resolve(this.fetchFn({state: state, columns: columns})));
            }

            const columnDefs = columns.filter(col => col.visible !== false).map(col => ({
                key: col.key || '',
                searchable: col.searchable !== false,
                orderable:  col.sortable   !== false
            }));

            const ajaxParams = {
                tinyDataTable : true,
                paging : {
                    page: state.page,
                    length: state.pagingEnabled ? state.pageSize : -1,
                    start: state.pagingEnabled ? (state.page - 1) * state.pageSize : 0,
                    pagingEnabled: state.pagingEnabled
                },
                searchText: state.searchText,
                columns : columnDefs,
                order : state.sortOrders,
                // Pass filters through to the server so backends can
                // implement arbitrary filtering logic.
                filters : state.filters || {}
            };

            const buildParams = this.ajax.buildParams ?? function (s) {return s;};
            const params = buildParams(ajaxParams);

            const method = (this.ajax.method || 'GET').toUpperCase();
            const url = typeof this.ajax.url === 'function'
                ? this.ajax.url({state: state, columns: columns})
                : this.ajax.url;
            const headers = this.ajax.headers || {};

            return _handleFetchResponse(_dtAjaxRequest(url, { method, params, headers, signal: state.__signal }));
        }
    }

    // -----------------------------
    // TinyDataTable main class
    // -----------------------------

    class TinyDataTable {
        /**
         * Static semantic version of the TinyDataTable library. This is
         * useful for debugging and feature checks at runtime.
         */
        static get version() {
            return TINYDATATABLE_VERSION;
        }


        constructor(tableSelector, options) {
            var table = typeof tableSelector === 'string'
                ? document.querySelector(tableSelector)
                : tableSelector;

            if (!table) throw new Error(`TinyDataTable: table element not found (selector: ${String(tableSelector)})`);
            if (!_isNode(table)) throw new Error(`TinyDataTable: invalid table argument. Expected a DOM Element (<table>), got ${Object.prototype.toString.call(table)}`);

            this.table = table;
            this.table.classList.add(TINY_TABLE_CLASSES.root);

            this.id = this.table?.id || this.table.getAttribute('data-tt-id') || ('tt-' + Math.random().toString(36).slice(2));

            const dataset = table.dataset;
            this.options = options || {};
            this.locale = this.options.locale || navigator.language || navigator.userLanguage || 'en-US';

            // Instance texts: defaults + per-table overrides
            this.texts = Object.assign({}, TinyDataTable.defaults.texts, this.options.texts);

            // Empty message from options or data attribute
            this.emptyMessage = (this.options.emptyMessage != null ? this.options.emptyMessage : dataset.inplaceEmptyMessage) || this.texts.emptyMessage;

            // Scrolling options
            // scrollX / scrollY can be:
            //   - false  -> no scrolling in that axis
            //   - 'auto' -> overflow:auto (default for X)
            //   - any other truthy value -> overflow:scroll
            this.scrollX = (this.options.scrollX !== undefined) ? this.options.scrollX : 'auto';
            this.scrollY = (this.options.scrollY !== undefined) ? this.options.scrollY : false;


            // Internal draw sequencing for async safety (Ajax) + performance caches
            this._internals = {
                drawSeq: 0,
                activeAbort: null,
                visibleColumns: null,
                visibleColumnCount: null,
                renderPlan: null,
                lastHighlightQuery: null,
                tooltipsDelegated: false
            };

            this._events = Object.create(null);

            /**
             * Wrapper around the table when horizontal/vertical scrolling
             * is enabled. The wrapper only ever contains the <table>,
             * never the pager or external controls.
             */
            this.wrapper = null;

            /**
             * Optional high-level container that wraps the controls,
             * wrapper/table, and pager. It is only created when there is
             * at least one of: pager, search input, or filters bar.
             */
            this.container = null;

            /**
             * Optional container that hosts toolbar-style controls such as
             * the search input and the filters bar.
             */
            this.controlsContainer = null;

            /**
             * Reference to the search <input> element when search UI is
             * enabled. This is useful for integrations that need direct
             * access to the input node.
             */
            this.searchInput = null;

            var cols = this.options.columns || [];
            this.columns = cols.map(function (col) {
                var base = {
                    sortable: true,
                    searchable: true,
                    visible: true
                };
                for (var k in col) {
                    if (Object.prototype.hasOwnProperty.call(col, k)) {
                        base[k] = col[k];
                    }
                }
                return base;
            });

            const hasAjax = dataset.url || this.options.ajax?.url;
            this.paging = {
                enabled: this.options.paging?.enabled !== undefined
                    ? this.options.paging.enabled
                    : (hasAjax ? true : false),
                pageSize: this.options.paging?.pageSize !== undefined
                    ? this.options.paging.pageSize
                    : 100,
                serverSide: this.options.paging?.serverSide !== undefined
                    ? this.options.paging.serverSide
                    : false,
                pageSizeOptions: this.options.paging?.pageSizeOptions
                    ? this.options.paging.pageSizeOptions
                    : [10, 25, 50, 100]
            };

            this.footer = {
                enabled: this.options.footer?.enabled !== undefined
                    ? this.options.footer.enabled
                    : false,

                // NEW (no back-compat): { [columnKey]: 'sum'|'avg'|function }
                aggregates: (this.options.footer?.aggregates && typeof this.options.footer.aggregates === 'object')
                    ? this.options.footer.aggregates
                    : {}
            };

            this.childRows = {
                enabled: !!this.options.childRows?.enabled,
                dataKey: this.options.childRows?.dataKey || 'children',
                startExpanded: this.options.childRows?.startExpanded !== undefined
                    ? this.options.childRows.startExpanded
                    : false,
                rowId: this.options.childRows?.rowId || null,
                toggleOnRowClick: this.options.childRows?.toggleOnRowClick !== undefined
                    ? this.options.childRows.toggleOnRowClick
                    : true,
                showToggleIcon: this.options.childRows?.showToggleIcon !== undefined
                    ? this.options.childRows.showToggleIcon
                    : true,
                columns: this.options.childRows?.columns || null,
                getColumns: this.options.childRows?.getColumns || null
            };

            this.normalizeColumn(this.childRows.columns,'childcol');

            this.highlight = {
                enabled: this.options.highlight?.enabled === true,
                contextSelector: this.options.highlight?.contextSelector || null,
                markOptions: this.options.highlight?.markOptions || {}
            };

            // Grouping configuration
            var groupingOpt = this.options.grouping || {};
            this.grouping = {
                enabled: !!groupingOpt.enabled,
                keys: Array.isArray(groupingOpt.keys) ? groupingOpt.keys.slice() : null,
                mergeColumns: Array.isArray(groupingOpt.mergeColumns) ? groupingOpt.mergeColumns.slice() : [],
                header: {
                    show: groupingOpt.header?.show !== undefined
                        ? groupingOpt.header.show
                        : false,
                    render: typeof groupingOpt.header?.render === 'function'
                        ? groupingOpt.header.render
                        : null
                }
            };
            this.customClass = this.options.customClass;

            // High-level search configuration (controls visibility of the
            // search input; the actual search logic uses state.searchText).
            this.searchConfig = {
                enabled: !!this.options.search?.enabled,
                selector: this.options.search?.selector,
                label: this.options.search?.label,
                placeholder: this.options.search?.placeholder || this.texts.searchPlaceholder,
                debounceMs: (typeof this.options.search?.debounceMs === 'number') ? this.options.search.debounceMs : 150
            };

            // Column filters configuration (purely declarative; the LocalDataSource
            // and AjaxDataSource implementations are responsible for applying filters).
            var filtersOpt = this.options.filters || {};
            this.filters = {
                enabled: !!filtersOpt.enabled,
                items: Array.isArray(filtersOpt.items) ? filtersOpt.items : []
            };

            // Selection configuration

            var selectOpt = this.options.select;
            var selectEnabled = false;
            var groupMode = 'row';

            if (selectOpt === true) {
                selectEnabled = true;
            } else if (selectOpt && typeof selectOpt === 'object') {
                selectEnabled = !!selectOpt.enabled;
                if (selectOpt.groupMode === 'group') groupMode = 'group';
            }

            this.select = {
                enabled: selectEnabled,
                groupMode: groupMode
            };

            // Initial filters state derived from the filters configuration.
            var initialFiltersState = {};

            if (this.filters && this.filters.enabled && Array.isArray(this.filters.items)) {
                this.filters.items.forEach(function (f) {
                    if (!f || !f.key) return;

                    (!f.type||f.type=='boolean') && (f.type='bool');

                    if (f.type === 'bool') {
                        // defaultValue defaults to false
                        var def = f.defaultValue != null ? !!f.defaultValue : false;

                        // Only set state when active (true)
                        if (def) {
                            initialFiltersState[f.key] = true;
                        }

                    } else {
                        // Non-boolean filters: accept any non-null/undefined defaultValue
                        if (f.defaultValue != null) {
                            initialFiltersState[f.key] = f.defaultValue;
                        }
                    }
                });
            }

            // Core state object used for paging, search, sorting and filters.
            this.state = {
                page: 1,
                pageSize: this.paging.pageSize,
                pagingEnabled: this.paging.enabled,
                searchText: '',
                sortOrders: _normalizeDefaultSort(this.options.defaultSort||this.options.order, this.columns),
                totalRows: 0,
                filters: initialFiltersState
            };


            this._expandedRowKeys = new Set();
            this._childRowsInitialized = false;

            // Selection state
            this._selectedRowKeys = new Set();
            this._rowDataByKey = {};
            this._pageParentRowKeys = [];
            this._pageGroupRowKeyMap = null;
            this._headerSelectCheckbox = null;
            this._lastPageRows = [];

            // dataset.loadonceUrl is a URL string if present (data-loadonce-url="...")
            const loadOnceUrl = dataset.loadonceUrl;

            // Resolve the effective ajax URL with precedence:
            const ajaxUrl = loadOnceUrl || dataset.url || this.options.ajax?.url;
            const useAjax = ajaxUrl || typeof this.options.ajax?.fetch === 'function';
            const loadOnce = !!loadOnceUrl || this.options.ajax?.loadOnce === true;

            if (useAjax && loadOnce) {
                // Hybrid: ajax once, then fully local (search/sort/paging)
                this.options.ajax = this.options.ajax || {};
                this.options.ajax.url = ajaxUrl;

                // normalize flag on options for use in AjaxLoadOnceDataSource
                if (this.options.ajax.loadOnce == null) {
                    this.options.ajax.loadOnce = true;
                }

                this.dataSource = new AjaxLoadOnceDataSource(this.options.ajax, this);
                this._isAjax = false; // behaviour is local after first load

            } else if (useAjax) {
                // Classic ajax mode (no load-once hybrid)
                this.options.ajax = this.options.ajax || {};
                this.options.ajax.url = ajaxUrl;

                this.dataSource = new AjaxDataSource(this.options.ajax, this);
                this._isAjax = true;

            } else if (Array.isArray(this.options.data)) {
                // Pure local data
                this.dataSource = new LocalDataSource(this.options.data || [], this);
                this._isAjax = false;

            } else {
                throw new Error('DataSource Error: no ajax url and no data array provided.');
            }


            this.thead = null;
            this.tbody = null;
            this.tfoot = null;
            this.footerRow = null;
            this.pagerContainer = null;
            this.pager = null;

            // Create a high-level container when at least one of the
            // optional outer UI pieces (pager, search input, filters bar)
            // is enabled. This ensures the scroll wrapper only ever wraps
            // the table while the container wraps the whole widget.
            this._ensureContainer();
            this._initWrapper();
            this._initStructure();
            //this._emit('init', {});
            if (typeof this.options.afterInit === 'function') {
                this.options.afterInit.call(this.api());
            }
            this.draw();
        }

        api() { return this; }

        on(event, handler) {
            if (!this._events[event]) this._events[event] = [];
            this._events[event].push(handler);
            return this;
        }

        off(event, handler) {
            if (!this._events[event]) return this;
            if (!handler) {
                this._events[event] = [];
                return this;
            }
            this._events[event] = this._events[event].filter(function (fn) {
                return fn !== handler;
            });
            return this;
        }

        _emit(event, payload) {
            var handlers = this._events[event];
            if (!handlers || handlers.length === 0) return;
            var api = this.api();
            handlers.forEach(function (fn) {
                try {
                    fn.call(api, payload, api);
                } catch (err) {
                    if (typeof window !== 'undefined' && window.console) {
                        console.error('TinyDataTable handler error for event', event, err);
                    }
                }
            });
        }

        getTableElement() {
            return this.table;
        }

        getHeaderElement() {
            return this.thead;
        }

        getBodyElement() {
            return this.tbody;
        }

        getFooterElement() {
            return this.tfoot;
        }

        getPagerElement() {
            return this.pagerContainer;
        }

        getDom() {
            return {
                table: this.table,
                thead: this.thead,
                tbody: this.tbody,
                tfoot: this.tfoot,
                pager: this.pagerContainer
            };
        }

        // Get table headers from the column definitions
        headers(visibleOnly = true) {
            const headers = [];
            this.columns.forEach(col => {
                if (!(visibleOnly && col.visible === false)) {
                    headers.push(col.title || '');  // Push the title or an empty string if not set
                }
            });
            return headers;
        }

        /*
        getFullData(visibleOnly = true) {
            var self = this;

            // Helper function to process a single row (either parent or child)
            function processRow(row, visibleOnly, isChild) {
                // Determine the columns to use (child columns if isChild is true)
                const columns = isChild ? self._getChildColumnsForParent(row) : self.columns;

                return columns.reduce(function (acc, col) {
                    // Skip non-visible columns if visibleOnly is true
                    if (visibleOnly && col.visible === false) {
                        return acc;  // Skip this column by not adding it to the accumulator
                    }

                    var rawValue = row[col.key];  // Get raw data for the current column

                    var content = self._renderValue(col, rawValue, row, acc.length, "value", {
                        isChild: !!isChild,
                        rowKey: row.key
                    });

                    // Skip null or undefined values
                    if (content != null) {
                        acc.push(content);  // Add the processed content for this column
                    }

                    return acc;  // Return the accumulator for the next iteration
                }, []);  // Initialize the accumulator as an empty array
            }

            const savePagingEnabled = this.state.pagingEnabled;
            this.state.pagingEnabled = false;
            // Fetch the data from the data source
            return this.dataSource.load(this.state, this.columns).then(function (result) {
                const rows = Array.isArray(result.rows) ? result.rows : [];  // Ensure rows is an array

                // Process the rows (parent and child rows) by rendering them based on columns
                const processedData = rows.reduce(function (acc, row) {
                    // Process the current row (whether parent or child) using the unified `processRow` function
                    const rowData = processRow(row, visibleOnly, false);

                    // If the row has children, process the child rows and append their data
                    if (row.children && row.children.length > 0) {
                        // Recursively process child rows and append their data to the parent row's data
                        rowData.push(...row.children.reduce(function (childAcc, childRow) {
                            // Process each child row using the same `processRow` function
                            const childData = processRow(childRow, visibleOnly, true);  // Pass `true` for child rows
                            childAcc.push(childData);
                            return childAcc;
                        }, []));
                    }

                    acc.push(rowData);  // Add the parent row data to the accumulator
                    return acc;  // Return the accumulated row data
                }, []);  // Start with an empty array for all rows

                // Return the processed data with both parent and child rows
                return processedData;
            }).finally(() => {
                this.state.pagingEnabled = savePagingEnabled;
            })
        }
        */
        getFullData(visibleOnly = true, exportOnly = true) {
            const self = this;

            // Predicate used to decide if a column is included in the export dataset
            const isExportableColumn = (col) => {
                if (visibleOnly && col.visible === false) return false;
                if (exportOnly && (col.export === false || col.className?.includes('no-export'))) return false;
                return true;
            };

            // Use the SAME columns for headers + rows so lengths always match
            const cols = this.columns.filter(isExportableColumn);

            const headers = cols.map(col => ({
                label: col.label ?? col.title ?? '',
                type: col.type ?? null
            }));

            // Reused HTML stripper (no DOM insertion)
            const _stripper = document.createElement('div');
            const stripHtml = (html) => {
                _stripper.innerHTML = String(html ?? '');
                return _stripper.textContent || '';
            };

            // Build one fixed-width row array (always cols.length entries)
            function buildRowArray(row, rowIndex, isChild) {
                return cols.map((col, colIndex) => {
                    const rawValue = row ? row[col.key] : null;

                    let content = self._renderValue(col, rawValue, row, colIndex, "value", {
                        isChild: !!isChild,
                        rowKey: row && row.key,
                        rowIndex: rowIndex
                    });

                    // IMPORTANT: keep placeholder so the row never becomes ragged
                    if (content == null) return '';

                    // Normalize common render return types for export use
                    if (typeof content === 'object' && content.html != null) {
                        return stripHtml(content.html);
                    }

                    // DOM Node -> use its text
                    if (_isNode(content)) return content.textContent || '';

                    return String(content);
                });
            }

            const savedPagingEnabled = this.state.pagingEnabled;
            this.state.pagingEnabled = false;

            // Keep the load call consistent with the *table state*, but we only render/export filtered cols.
            return this.dataSource.load(this.state, this.columns)
                .then(function (result) {
                    const rows = Array.isArray(result?.rows) ? result.rows : [];

                    // Flat list of rows: parent row, then each child row as its own row
                    const outRows = [];
                    rows.forEach((row, i) => {
                        outRows.push(buildRowArray(row, i, false));

                        const children =
                            (self.childRows?.enabled ? self._getChildrenForRow(row) : null) || [];
                        children.forEach((childRow, ci) => {
                            outRows.push(buildRowArray(childRow, ci, true));
                        });
                    });

                    return { headers, rows: outRows };
                })
                .finally(() => {
                    this.state.pagingEnabled = savedPagingEnabled;
                });
        }

        /**
         * Draw (render) the table using the current state (paging/search/sort/filters).
         * In Ajax/server-side mode this triggers a request; in local mode it re-renders immediately.
         */
        draw() {
            const self = this;

            // Refresh caches once per draw (visible columns, counts, render plan)
            this._refreshColumnCaches();

            const drawId = ++this._internals.drawSeq;

            // Ajax-only: abort previous in-flight request, attach signal to state
            if (self._isAjax) {
                try {
                    if (self._internals.activeAbort) self._internals.activeAbort.abort();
                } catch (e) { /* noop */ }
                self._internals.activeAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                self.state.__signal = self._internals.activeAbort ? self._internals.activeAbort.signal : undefined;
            } else {
                self.state.__signal = undefined;
            }

            function onLoad(result) {
                // Ignore stale async results (out-of-order Ajax responses)
                if (self._isAjax && drawId !== self._internals.drawSeq) return;

                const rows = Array.isArray(result && result.rows) ? result.rows : [];
                const total = (result && typeof result.total === 'number') ? result.total : rows.length;

                self.state.totalRows = total;
                self._lastPageRows = rows;

                if (self._isAjax) {
                    self._emit('xhr', {
                        rows: rows,
                        total: total,
                        state: Object.assign({}, self.state)
                    });
                }

                self._renderBody(rows);

                if (self.pager) self.pager.update();
                self._updateSortIndicators();

                const allRowsForFooter = self._getAllVisibleRowsForAggregates(rows);
                self._updateFooterAggregates(allRowsForFooter);

                self._postBodyRender(rows);

                // Tooltips for dynamically rendered rows (delegated when possible)
                self._initTooltipsInScope(self.tbody);

                const drawSettings = {
                    table: self.table,
                    state: Object.assign({}, self.state),
                    columns: self.columns,
                    options: self.options,
                    dom: self.getDom()
                };

                self._emit('draw', drawSettings);
                if (typeof self.options.drawCallback === 'function') {
                    self.options.drawCallback.call(self.api(), drawSettings);
                }
            }

            if (self._isAjax) self.table.classList.add(TINY_TABLE_CLASSES.loading);

            return this.dataSource.load(this.state, this.columns)
                .then(onLoad)
                .catch(function (err) {
                    // Abort is expected under rapid input / pagination
                    if (err && err.name === 'AbortError') return;
                    // Common status-specific handling (optional)
                    const status = err && err.status;

                    // Optional centralized error hook
                    if (typeof self.options.onError === 'function') {
                        try { self.options.onError(err); } catch (e) { /* noop */ }
                    } else if (status !== 401 && typeof console?.error !== 'undefined') {
                        console.error('TinyDataTable error:', err);
                        if (err && err.body) console.error('Response body:', err.body);
                    }

                    if (status === 401) {
                        // Unauthorized: typically session expired / login redirect
                        self._emit('error:unauthorized', { error: err, status });
                        // You can also optionally show a UI message here if you want
                        // (avoid forcing behavior: leave to user-land via onError/event)
                    } else if (status === 500) {
                        self._emit('error:server', { error: err, status });
                    } else if (typeof status === 'number') {
                        self._emit('error:http', { error: err, status });
                    } else {
                        self._emit('error', { error: err });
                    }

                    // Do not silently swallow errors (critical for html mode invalid Node returns)
                    throw err;
                })

                .finally(function () {
                    if (self._isAjax) {
                        try { self.table.classList.remove(TINY_TABLE_CLASSES.loading); } catch (e) { /* noop */ }
                    }
                });
        }

        refresh() {
            if (typeof this.dataSource.refresh === 'function') this.dataSource.refresh();
                return this.draw();
        }
        /**
         * Set the global search text and re-draw.
         * @param {string} text
         */

        search(text) {
            this.state.searchText = text || '';
            this.state.page = 1;
            this._emit('search', {searchText: this.state.searchText});
            return this.draw();
        }

        _getTooltipAdapter() {
            // User provided adapter can be:
            //  - a function(el, content)
            //  - an object: { bind(el, content), delegate(root, options) }
            if (GLOBAL_TOOLTIP_ADAPTER) {
                return GLOBAL_TOOLTIP_ADAPTER;
            }

            // Built-in Tippy.js adapter (if available)
            if (typeof window !== "undefined" && window.tippy) {
                const tippy = window.tippy;
                return {
                    delegate: function (root) {
                        if (typeof tippy.delegate !== "function") return false;
                        tippy.delegate(root, {
                            target: "[data-tooltip]",
                            allowHTML: true,
                            content: function (ref) { return ref.getAttribute("data-tooltip") || ""; }
                        });
                        return true;
                    },
                    bind: function (el, content) {
                        if (!content) return;
                        if (typeof tippy === "function") {
                            tippy(el, { content: content, allowHTML: true });
                        }
                    }
                };
            }

            return null;
        }
        _initTooltipsInScope(root) {
            const adapter = this._getTooltipAdapter();
            if (!adapter) return;

            const tooltipsOpt = (this.options && this.options.tooltips) || {};

            // 1) Prefer delegation if supported and not disabled
            if (!this._internals.tooltipsDelegated &&
                tooltipsOpt.delegate !== false &&
                adapter && typeof adapter === "object" &&
                typeof adapter.delegate === "function") {

                const ok = adapter.delegate(root, tooltipsOpt);
                if (ok !== false) {
                    this._internals.tooltipsDelegated = true;
                    return; // delegated: no scan/bind per draw
                }
            }

            // 2) Fallback: per-element binding
            const bindFn =
                (typeof adapter === "function") ? adapter :
                    (adapter && typeof adapter === "object" && typeof adapter.bind === "function") ? adapter.bind :
                        null;

            if (!bindFn) return;

            const rootScope = this.tbody || this.table;
            const elements = rootScope.querySelectorAll("[data-tooltip]");
            elements.forEach((el) => {
                if (el._dtTooltipInited) return;
                el._dtTooltipInited = true;
                bindFn(el, el.getAttribute("data-tooltip"));
            });
        }

        /**
         * Toggle sorting for a given column key.
         * Cycles for that key: none -> asc -> desc -> none.
         * After a click, only this key is used (single-column sort via UI).
         * Multi-column sorting is intended for defaultSort / programmatic use.
         */
        /**
         * Toggle sorting for a given column key.
         * Default click: single-column sort only (sortOrders becomes [key] or []).
         * Shift+click (opts.append=true): multi-sort (add/promote key while keeping other sort specs).
         *
         * Cycle for the clicked key: none -> asc -> desc -> none
         */
        /**
         * Sort by a column key (or array of sort orders) and re-draw.
         * @param {string|Array<{key:string,dir:'asc'|'desc'}>} key
         * @param {'asc'|'desc'} [dir]
         */

        sortBy(key, opts) {
            opts = opts || {};
            var append = !!opts.append;

            // Find column and ensure sortable
            var col = null;
            for (var i = 0; i < this.columns.length; i++) {
                if (this.columns[i].key === key) { col = this.columns[i]; break; }
            }
            if (!col || col.sortable === false) return;

            var prevOrders = this.state.sortOrders ? this.state.sortOrders.slice() : [];
            var orders = prevOrders.slice();

            // Find existing order for this key
            var index = -1;
            for (var j = 0; j < orders.length; j++) {
                if (orders[j] && orders[j].key === key) { index = j; break; }
            }

            // Determine currentDir
            var currentDir = (index === -1) ? null : (orders[index].dir || orders[index].direction || null);
            currentDir = currentDir ? String(currentDir).toLowerCase() : null;

            // Cycle: none -> asc -> desc -> none
            var nextDir;
            if (!currentDir) nextDir = 'asc';
            else if (currentDir === 'asc') nextDir = 'desc';
            else nextDir = null;

            var changed = { key: key, dir: nextDir };
            var nextOrders = [];

            if (!append) {
                // SINGLE SORT: replace with only clicked column (or none)
                nextOrders = nextDir ? [{ key: key, dir: nextDir }] : [];
            } else {
                // MULTI SORT (Shift): append new key as LAST priority, toggle existing IN PLACE
                nextOrders = orders.slice();

                if (index === -1) {
                    // Not present -> add as last (secondary/tertiary/etc.)
                    if (nextDir) nextOrders.push({ key: key, dir: nextDir });
                } else {
                    if (nextDir) {
                        // Toggle dir but KEEP its position (priority)
                        nextOrders[index] = { key: key, dir: nextDir };
                    } else {
                        // Remove it, keep relative order of others
                        nextOrders.splice(index, 1);
                    }
                }
            }

            this.state.sortOrders = nextOrders;
            this.state.page = 1;

            this._emit('order', {
                sortOrders: this.state.sortOrders.slice(),
                previousSortOrders: prevOrders,
                changed: changed,
                append: append
            });

            return this.draw();
        }


        /**
         * Change the current page (1-based) and re-draw.
         * @param {number} page
         */

        goToPage(page) {
            if (!this.paging.enabled) return;
            var maxPage = Math.max(1, Math.ceil(this.state.totalRows / this.state.pageSize));
            var oldPage = this.state.page;
            var newPage = Math.min(Math.max(1, page), maxPage);

            if (newPage === oldPage) return;

            this.state.page = newPage;
            this._emit('page', {page: newPage, oldPage: oldPage});
            return this.draw();
        }

        setData(data) {
            if (!(this.dataSource instanceof LocalDataSource)) {
                throw new Error('setData is only available in local data mode');
            }
            this.dataSource.setData(data || []);
            this.state.page = 1;
            return this.draw();
        }

        /**
         * Get the currently selected row keys.
         * The key is determined by `columns[].key` + internal row-key rules (see README).
         * @returns {Array<string>}
         */

        getSelectedRowKeys() {
            return Array.from(this._selectedRowKeys);
        }

        /**
         * Get the data objects of the currently selected rows.
         * @returns {Array<Object>}
         */

        getSelectedRows() {
            var result = [];
            var keys = this.getSelectedRowKeys();
            var dataMap = this._rowDataByKey || {};
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (Object.prototype.hasOwnProperty.call(dataMap, k)) {
                    result.push(dataMap[k]);
                }
            }
            return result;
        }

        /**
         * Clear current selection and re-draw selection UI.
         */

        clearSelection() {
            this._selectedRowKeys.clear();
            this._syncSelectionDomAndHeader();
            this._emit('select', {
                mode: 'clear',
                rowKey: null,
                checked: false,
                affectedRowKeys: [],
                selectedRowKeys: this.getSelectedRowKeys()
            });
        }

        /**
         * Select a row by its rowKey.
         * @param {string} rowKey
         */

        selectRow(rowKey) {
            if (!rowKey) return;
            this._selectedRowKeys.add(String(rowKey));
            this._syncSelectionDomAndHeader();
        }

        /**
         * Unselect a row by its rowKey.
         * @param {string} rowKey
         */

        unselectRow(rowKey) {
            if (!rowKey) return;
            this._selectedRowKeys.delete(String(rowKey));
            this._syncSelectionDomAndHeader();
        }

        /**
         * Select all selectable rows on the current page.
         */

        selectAllOnPage() {
            var self = this;
            if (!this._pageParentRowKeys) return;
            this._pageParentRowKeys.forEach(function (k) {
                self._selectedRowKeys.add(k);
            });
            this._syncSelectionDomAndHeader();
        }

        /**
         * Unselect all rows on the current page.
         */

        unselectAllOnPage() {
            var self = this;
            if (!this._pageParentRowKeys) return;
            this._pageParentRowKeys.forEach(function (k) {
                self._selectedRowKeys.delete(k);
            });
            this._syncSelectionDomAndHeader();
        }


        _loadLazyChildren(rowKey) {
            const cfg = this.childRows;
            if (!cfg.lazyLoad) return Promise.resolve([]);
            const parent = this._rowDataByKey[rowKey];
            if (!parent) return Promise.resolve([]);
            const parentId = cfg.rowId ? cfg.rowId(parent) : parent.id;
            if (!parentId) return Promise.resolve([]);
            if (!this._isAjax || !this.options.ajax?.url) return Promise.resolve([]);
            return _dtAjaxRequest(this.options.ajax.url, {
                params: {child: true, rowId: parentId}
            }).then(json => Array.isArray(json) ? json : []);
        }

        /**
         * Expand child rows for the given parent rowKey.
         * If `childRows.lazyLoad` is enabled, this may trigger a children Ajax request.
         * @param {string} rowKey
         */

        expandChildRows(rowKey) {
            if (!this.childRows.enabled || !rowKey) return;
            const afterInsertChildRows = (rowKey) => {
                this._insertChildRowsForParent(rowKey);
                this._emit("childShown", {rowKey});
            }
            const dataKey = this.childRows.dataKey || "children";
            const row = this._rowDataByKey[rowKey];
            if (this.childRows.lazyLoad && (!row[dataKey] || row[dataKey].length === 0)) {
                this._expandedRowKeys.add(rowKey);
                return this._loadLazyChildren(rowKey).then(children => {
                    row[dataKey] = children || [];
                    afterInsertChildRows(rowKey);
                });
            } else {
                this._expandedRowKeys.add(rowKey);
                afterInsertChildRows(rowKey);
            }
        }

        /**
         * Collapse child rows for the given parent rowKey.
         * @param {string} rowKey
         */

        collapseChildRows(rowKey) {
            if (!this.childRows.enabled || !rowKey) return;
            if (!this._expandedRowKeys.has(rowKey)) return;

            this._expandedRowKeys.delete(rowKey);
            this._emit('childHidden', {rowKey: rowKey});

            // Only remove the child rows for this parent
            this._removeChildRowsForParent(rowKey);
        }

        /**
         * Toggle child rows for the given parent rowKey.
         * @param {string} rowKey
         */

        toggleChildRows(rowKey) {
            if (!this.childRows.enabled || !rowKey) return;
            if (this._expandedRowKeys.has(rowKey)) {
                this.collapseChildRows(rowKey);
            } else {
                this.expandChildRows(rowKey);
            }
        }

        /**
         * Collapse all currently expanded child rows.
         */

        collapseAllChildRows() {
            if (!this.childRows.enabled) return;
            if (this._expandedRowKeys.size === 0) return;

            this._expandedRowKeys.clear();
            this._emit('childHidden', {rowKey: null, all: true});

            // Remove all child rows in one shot
            if (this.tbody) {
                var childSelector = 'tr.' + TINY_TABLE_CLASSES.childRow;
                this.tbody.querySelectorAll(childSelector).forEach(function (tr) {
                    tr.remove();
                });

                // Reset all toggle icons
                var iconSelector = '.' + TINY_TABLE_CLASSES.toggleIcon + '[data-tt-toggle="row"].expanded';
                this.tbody.querySelectorAll(iconSelector).forEach(function (icon) {
                    icon.classList.remove('expanded');
                });
            }

            if (this.highlight && this.highlight.enabled) {
                this._applyHighlight();
            }
        }

        _getRowKey(row, rowIndex, fallbackPrefix) {
            var prefix = fallbackPrefix || 'row';
            if (typeof this.childRows.rowId === 'function') {
                var k = this.childRows.rowId(row);
                if (k != null) return String(k);
            }
            if (row && row.id != null) return String(row.id);
            if (row && typeof row.__dt_index === 'number') return String(row.__dt_index);
            return prefix + '-' + rowIndex;
        }

        _getChildrenForRow(row) {
            if (!this.childRows.enabled) return null;
            var key = this.childRows.dataKey;
            var value = row && row[key];
            if (!Array.isArray(value) || value.length === 0) return null;
            return value;
        }

        _hasChildRows(row) {
            var children = this._getChildrenForRow(row);
            return !!(children && children.length);
        }

        _getChildColumnsForParent(parentRow) {
            var cfg = this.childRows || {};
            var cols = null;

            if (typeof cfg.getColumns === 'function') {
                cols = cfg.getColumns(parentRow);
            } else if (Array.isArray(cfg.columns) && cfg.columns.length) {
                cols = cfg.columns;
            } else {
                cols = this.columns;
            }

            cols = Array.isArray(cols) ? cols : [];

            // Ensure child columns are normalized and visibility rules are respected.
            // (renderDataRow no longer checks col.visible === false for performance reasons)
            this.normalizeColumn(cols, 'childcol');
            return cols.filter(function (c) { return !(c && c.visible === false); });
        }


        _insertChildRowsForParent(rowKey) {
            if (!this.tbody || !rowKey) return;

            var parentTr = this.tbody.querySelector('tr[data-row-key="' + rowKey + '"]');
            if (!parentTr) return;

            var row = this._rowDataByKey[rowKey];
            if (!row) return;

            var children = this._getChildrenForRow(row);
            if (!children || !children.length) return;

            var childColumns = this._getChildColumnsForParent(row);
            var groupKey = parentTr.dataset.groupKey || null;
            var self = this;

            var frag = document.createDocumentFragment();

            children.forEach(function (childRow, childIndex) {
                var childKey = self._getRowKey(
                    childRow,
                    childIndex,
                    'child-of-' + rowKey
                );

                var childTr = self._renderDataRow(
                    childRow,
                    childIndex,
                    childKey,
                    true,
                    childColumns,
                    {
                        hasChildren: false,
                        isExpanded: false,
                        mergeColumnsSet: null,
                        groupSize: 1,
                        rowIndexInGroup: 0,
                        groupKey: groupKey
                    }
                );

                childTr.classList.add(TINY_TABLE_CLASSES.childRow);
                childTr.dataset.parentKey = rowKey;
                frag.appendChild(childTr);
            });

            parentTr.parentNode.insertBefore(frag, parentTr.nextSibling);

            var icon = parentTr.querySelector('.' + TINY_TABLE_CLASSES.toggleIcon + '[data-tt-toggle="row"]');
            if (icon) icon.classList.add('expanded');

            if (this.highlight && this.highlight.enabled) {
                this._applyHighlight();
            }
        }

        _removeChildRowsForParent(rowKey) {
            if (!this.tbody || !rowKey) return;

            var selector = 'tr.' + TINY_TABLE_CLASSES.childRow +
                '[data-parent-key="' + rowKey + '"]';

            this.tbody.querySelectorAll(selector).forEach(function (tr) {
                tr.remove();
            });

            var parentTr = this.tbody.querySelector('tr[data-row-key="' + rowKey + '"]');
            if (parentTr) {
                var icon = parentTr.querySelector('.' + TINY_TABLE_CLASSES.toggleIcon + '[data-tt-toggle="row"]');
                if (icon) icon.classList.remove('expanded');
            }

            if (this.highlight && this.highlight.enabled) {
                this._applyHighlight();
            }
        }

        _hasGrouping() {
            return !!(this.grouping &&
                this.grouping.enabled &&
                this.grouping.keys &&
                this.grouping.keys.length);
        }

        _buildGroups(rows) {
            var grouping = this.grouping;
            var groups = [];
            var groupIndexByKey = Object.create(null);

            rows.forEach(function (row) {
                var keyParts = grouping.keys.map(function (k) {
                    return row[k];
                });
                var groupKey = JSON.stringify(keyParts);

                var group;
                if (Object.prototype.hasOwnProperty.call(groupIndexByKey, groupKey)) {
                    group = groups[groupIndexByKey[groupKey]];
                } else {
                    group = {
                        key: groupKey,
                        values: {},
                        rows: []
                    };
                    grouping.keys.forEach(function (k, idx) {
                        group.values[k] = keyParts[idx];
                    });
                    groupIndexByKey[groupKey] = groups.length;
                    groups.push(group);
                }
                group.rows.push(row);
            });

            return groups;
        }


        /**
         * Refresh per-draw column caches to avoid repeated work inside hot loops.
         * Called once per draw (and whenever columns visibility/selection changes).
         */
        _refreshColumnCaches() {
            // Visible data columns (excluding select column)
            this._internals.visibleColumns = this.columns.filter(c => c.visible !== false);
            // Total visible grid columns, including select column (if enabled)
            this._internals.visibleColumnCount = this._internals.visibleColumns.length + (this.select?.enabled ? 1 : 0);
            // Render plan is used by HTML render mode (optional) and other optimizations
            this._internals.renderPlan = this._buildRenderPlan();
        }

        /**
         * Build a lightweight plan for rendering visible columns.
         * @param {Array<Object>} visibleColumns
         */
        _buildRenderPlan(visibleColumns) {
            return this._internals.visibleColumns.map(function (col) {
                return {
                    col: col,
                    className: col?.className,
                    hasTooltip: !!col?.tooltip,
                    hasRender: typeof col?.render === 'function'
                };
            });
        }

        _applyGroupRowCustomClass(tr, group, meta) {
            if (!this.customClass || !this.customClass.groupRow) return;

            var cfg = this.customClass.groupRow;
            var classes = (typeof cfg === 'function')
                ? cfg(group, meta || {})
                : cfg;

            if (classes && typeof classes === 'string') {
                classes = classes.trim().split(/\s+/);

                if (Array.isArray(classes)) {
                    classes.forEach(function (c) {
                        if (c && typeof c === 'string') {
                            tr.classList.add(c);
                        }
                    });
                }
            }
        }

        _renderGroupHeaderRow(group, groupIndex, visibleColCount) {
            var tr = _dtCreateElement('tr', TINY_TABLE_CLASSES.groupHeaderRow);

            var td = _dtCreateElement('td', TINY_TABLE_CLASSES.groupHeaderCell, { colSpan : visibleColCount});

            var label;
            if (this.grouping.header && typeof this.grouping.header.render === 'function') {
                label = this.grouping.header.render({
                    keys: this.grouping.keys,
                    values: group.values,
                    rows: group.rows,
                    groupIndex: groupIndex
                });
            } else {
                label = this.grouping.keys.map(function (k) {
                    return group.values[k];
                }).join(' - ');
            }

            if (label instanceof Node) {
                td.appendChild(label);
            } else {
                td.appendChild(document.createTextNode(label != null ? String(label) : ''));
            }

            tr.appendChild(td);

            this._applyCustomClass(tr, 'groupRow', group, {
                isGroupHeader: true,
                groupIndex: groupIndex,
                groupKey: group.key
            });

            return tr;
        }

        /**
         * Ensure that a high-level container exists when any outer UI
         * (pager, search box, filters bar) is enabled. The container wraps
         * the table or its scroll wrapper together with the pager.
         */
        _ensureContainer() {
            var needContainer =
                this.paging?.enabled ||
                this.searchConfig?.enabled ||
                (this.filters && this.filters.enabled &&
                    Array.isArray(this.filters.items) &&
                    this.filters.items.length > 0);

            if (!needContainer) return;

            // If a container already exists and is still in the DOM, reuse it.
            if (this.container && this.container.parentNode) {
                return;
            }

            var table = this.table;
            var parent = table.parentNode;
            if (!parent) return;

            // Create container and move the table into it.
            var container = _dtCreateElement('div', TINY_TABLE_CLASSES.container);
            parent.insertBefore(container, table);
            container.appendChild(table);

            this.container = container;
        }

        _initWrapper() {
            var needWrapper = this.scrollX !== false || this.scrollY !== false;
            if (!needWrapper) return;

            var table = this.table;
            var parent = table.parentNode;

            // Avoid double-wrapping
            if (!parent || (this.wrapper && this.wrapper.parentNode === parent)) return;

            var wrapper = _dtCreateElement('div', TINY_TABLE_CLASSES.wrapper);

            const _resolveOverflow = v => v === 'auto' ? 'auto' : (v ? 'scroll' : 'visible');

            wrapper.style.overflowX = _resolveOverflow(this.scrollX); // Horizontal scroll
            wrapper.style.overflowY = _resolveOverflow(this.scrollY); // Vertical scroll

            parent.insertBefore(wrapper, table);
            wrapper.appendChild(table);

            this.wrapper = wrapper;
        }

        normalizeColumn(col, syntheticPrefix, index='') {
            if (!col) return;
            const self = this;
            if (Array.isArray(col)) {
                col.forEach(function (c, index) {
                    self.normalizeColumn(c, syntheticPrefix, index);
                });
                return col;
            } else if (typeof col === 'object') {
                // 1) real key or synthetic key based on index
                if (col.key == null || col.key === '') {
                    col.key = '__' + (syntheticPrefix || 'col') + '_' + index;
                    col.isSyntheticKey = true;
                }
                // 2) Type-based default renderer (only if no explicit render is defined)
                if (!col.render && col.type && TinyDataTable.typeRenderers) {
                    const typeKey = String(col.type).toLowerCase();
                    const renderer = TinyDataTable.typeRenderers[typeKey];
                    if (renderer) {
                        col.render = renderer;
                    }
                }

                return col;
            }
        }


        _bindSearchInput(inputEl) {
            const self = this;
            if (!inputEl) return;

            inputEl.value = this.state.searchText || '';

            const typingDelay = typeof self.searchConfig?.debounceMs === 'number' ? self.searchConfig.debounceMs : 150;

            const onInput = debounce(function (e) {
                self.search(e.target.value);
            }, typingDelay);

            inputEl.addEventListener('input', onInput);

            this.searchInput = inputEl;
        }

        // -----------------------------
        // Controls bar: orchestrator + components
        // -----------------------------
        _initControlsBar() {
            const parentForControls = this.container;
            const anchorForControls = this.wrapper || this.table;

            if (!parentForControls || !anchorForControls) return;

            // Build components (each returns { el, order, align } or null)
            const components = [
                this._buildFiltersComponent(),
                this._buildSearchComponent(),
                this._buildButtonsComponent()
            ].filter(Boolean);

            // If no components to render, nothing to do
            if (!components.length) return;

            // Create controls bar only if there is at least one component
            const controls = _dtCreateElement('div', TINY_TABLE_CLASSES.controls);
            this.controlsContainer = controls;

            // Sort by order then append
            components
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
                .forEach(c => {
                    // Optional: apply alignment class now (no-op if you don’t use it yet)
                    if (c.align) {
                        // Example: tt-pos-left / tt-pos-center / tt-pos-right
                        controls.classList.add('tt-controls-has-align'); // optional marker
                        _dtAddClass(c.el, 'tt-pos-' + String(c.align).toLowerCase());
                    }

                    controls.appendChild(c.el);
                });

            parentForControls.insertBefore(controls, anchorForControls);

            this._initTooltipsInScope(this.controlsContainer); /// ?? why here
        }


        /**
         * Component interface:
         * {
         *   key: 'filters'|'search'|'buttons',
         *   el: HTMLElement,
         *   order: number,
         *   align: 'left'|'center'|'right'|undefined
         * }
         */

        // -----------------------------
        // Filters component
        // -----------------------------
        _buildFiltersComponent() {
            const self = this;

            const hasFiltersUI =
                this.filters &&
                this.filters.enabled &&
                Array.isArray(this.filters.items) &&
                this.filters.items.length > 0;

            if (!hasFiltersUI) return null;

            const filtersEl = _dtCreateElement('div', TINY_TABLE_CLASSES.filters);

            this.filters.items.forEach(function (def) {
                if (!def || !def.key) return;

                const item = _dtCreateElement('div', TINY_TABLE_CLASSES.filterItem, {
                    class: self.customClass?.filterItem
                });

                let labelEl = null;

                if (def.label) {
                    labelEl = _dtCreateElement('label', { text : String(def.label)});
                    item.appendChild(labelEl);
                }

                if (def.tooltip) {
                    item.setAttribute('data-tooltip', String(def.tooltip));
                }

                let controlNode;

                // NOTE: your demo uses type: 'boolean' but your current code checks 'bool'
                const isBoolean = (def.type === 'bool' || def.type === 'boolean');

                if (isBoolean) {
                    const switchLabel = _dtCreateElement('label', 'tt-switch');

                    const input = _dtCreateElement('input', { type: 'checkbox', checked : !!(self.state.filters && self.state.filters[def.key])});
                    switchLabel.appendChild(input);

                    const lever = _dtCreateElement('span', 'lever');
                    switchLabel.appendChild(lever);

                    input.addEventListener('change', function () {
                        if (!self.state.filters) self.state.filters = {};
                        self.state.filters[def.key] = !!this.checked;
                        self.state.page = 1;
                        self.draw();
                    });

                    controlNode = switchLabel;
                } else {
                    const opts = def.options || [];
                    const currentValue =
                        (self.state.filters && self.state.filters[def.key] != null)
                            ? String(self.state.filters[def.key])
                            : '';

                    const onFilterChange = function () {
                        const v = this.value;
                        if (!self.state.filters) self.state.filters = {};
                        self.state.filters[def.key] = (v === '' ? null : v);
                        self.state.page = 1;
                        self.draw();
                    };

                    controlNode = TinyDataTable.buildSelect(opts, currentValue, onFilterChange);
                    _dtAddClass(controlNode, self.customClass?.select);
                }

                if (def.id) controlNode.id = def.id;
                if (def.name) controlNode.name = def.name;
                if (labelEl && controlNode.id) labelEl.htmlFor = controlNode.id;

                item.appendChild(controlNode);
                filtersEl.appendChild(item);
            });

            return {
                key: 'filters',
                el: filtersEl,
                // temporary defaults (you’ll tune later when you do ordering/alignment)
                order: (typeof this.filters.order === 'number') ? this.filters.order : 2,
                align: this.filters.align // optional (left|center|right)
            };
        }


        // -----------------------------
        // Search component
        // -----------------------------
        _buildSearchComponent() {
            // Case A: internal search UI (rendered in controls bar)
            const hasSearchUI =
                this.searchConfig &&
                this.searchConfig.enabled &&
                this.searchConfig.selector !== '';

            if (hasSearchUI) {
                const searchEl = _dtCreateElement('div', TINY_TABLE_CLASSES.search);

                const hasLabel = !isBlank(this.searchConfig?.label);

                // Use table.id to match your desired output: "table-ajax-search"
                const tableId = this.table && this.table.id ? this.table.id : '';
                const inputId = tableId ? (tableId + '-search') : null;

                if (hasLabel) {
                    const labelAttrs = { text: this.searchConfig.label };
                    if (inputId) labelAttrs.for = inputId;

                    const labelEl = _dtCreateElement(
                        'label',
                        TINY_TABLE_CLASSES.searchLabel,
                        labelAttrs
                    );
                    searchEl.appendChild(labelEl);
                }

                const inputEl = _dtCreateElement('input', TINY_TABLE_CLASSES.searchInput, { type : 'search', placeholder : this.searchConfig.placeholder || '', value : this.state.searchText || ''});

                if (hasLabel && inputId) inputEl.id = inputId;

                this._bindSearchInput(inputEl);

                searchEl.appendChild(inputEl);

                return {
                    key: 'search',
                    el: searchEl,
                    order: (typeof this.searchConfig.order === 'number') ? this.searchConfig.order : 1,
                    align: this.searchConfig.align
                };
            }

            // Case B: external search selector (no component in controls bar, just bind)
            if (this.searchConfig && this.searchConfig.selector) {
                const inputEl = document.querySelector(this.searchConfig.selector);
                if (!inputEl) {
                    console.warn('TinyDataTable: search.selector input not found:', this.searchConfig.selector);
                } else {
                    this._bindSearchInput(inputEl);
                }
            }

            return null;
        }

        // -----------------------------
        // Buttons component
        // -----------------------------
        _buildButtonsComponent() {
            const self = this;
            // Recommended: allow buttons to be either array OR { items, order, align }
            const raw = this.options.buttons;

            const defs = Array.isArray(raw)
                ? raw
                : (raw && typeof raw === 'object' && Array.isArray(raw.items))
                    ? raw.items
                    : [];

            if (!defs.length) return null;

            // Refactor your existing _renderControlButtons logic into a builder that RETURNS the element.
            // Here is the expected pattern:

            const actionsEl = _dtCreateElement('div', TINY_TABLE_CLASSES.controlsActions);

            defs.forEach((def, i) => {
                if (!def) return;

                // Divider
                if (def.divider) {
                    actionsEl.appendChild(_dtCreateElement('span', 'tt-btn-divider'));
                    return;
                }

                // Allow raw Node insertion
                if (def instanceof Node) {
                    actionsEl.appendChild(def);
                    return;
                }

                // Allow HTML-only
                if (def.html && typeof def.html === 'string') {
                    const wrap = _dtCreateElement('span', 'tt-btn-html', { html : def.html});
                    actionsEl.appendChild(wrap);
                    return;
                }

                const btn = _dtCreateElement('button', undefined, { type: 'button' });

                if (def.id) btn.id = def.id;
                if (def.name) btn.name = def.name;
                if (def.title) btn.title = String(def.title);
                if (def.className) _dtAddClass(btn, def.className);

                // Disabled: bool or function
                const disabled = (typeof def.disabled === 'function') ? !!def.disabled(this.api()) : !!def.disabled;
                if (disabled) btn.disabled = true;

                const icon = typeof def.icon === 'string' ? def.icon.trim() : '';
                const html = typeof def.html === 'string' ? def.html.trim() : '';
                const text = typeof def.text === 'string' ? escapeHtml(def.text.trim()) : '';
                const tooltip = typeof def.tooltip === 'string' ? def.tooltip.trim() : '';
                const isBtnIcon = icon && !html && !text;

                btn.classList.add(isBtnIcon ? 'tt-btn-icon' : 'tt-btn');
                // icon-only case → HTML + special class
                if (isBtnIcon) {
                    btn.innerHTML = icon;
                }  else if (html) {
                    btn.innerHTML = [icon, html].filter(Boolean).join(' ');
                } else {  // text content (safe)
                    btn.textContent = [icon, text].filter(Boolean).join(' ');
                }

                if (tooltip) {
                    btn.setAttribute('data-tooltip', tooltip);   // for custom tooltip styling
                }
                // Click behavior
                const type = def.type ? String(def.type).toLowerCase() : '';

                if (type === 'export') {
                    if (Array.isArray(def.format) && def.format.length) {
                        // Create unique menu ID (to avoid conflicts if multiple export buttons)
                        const id = Math.random().toString(36).slice(2);
                        const menuId = `exportMenu_${id}`;

                        // Assign id to btn if missing (to use as triggerSelector)
                        if (!btn.id) btn.id = `exportButton_${id}`;
                        btn.classList.add('tt-dropdown-button');

                        // Create the popup menu <ul>
                        const menu = _dtCreateElement('ul','tt-dropdown',{id : menuId});

                        // Create <li> for each format in def.format array
                        def.format.forEach(fmt => {
                            const defaultLabel = `Export as ${fmt.toUpperCase()}`;
                            // Use label function from def, or from default config, or fallback to generic
                            const labelFn =
                                (def && typeof def.label === 'function' && def.label) ||
                                TinyDataTable.defaults?.texts?.exportButton?.label ||
                                (f => defaultLabel);
                            let label = labelFn(fmt);
                            // Defensive: ensure label is a non-empty string
                            label = typeof label === 'string' && label.trim() ? label : defaultLabel;
                            menu.appendChild(_dtCreateElement('li','item',{ 'data-format' : fmt, text: label}));
                        });

                        // Append menu to DOM, for example right after actionsEl or body
                        actionsEl.appendChild(menu);

                        // Instantiate Popup class with the created menu
                        new Popup(menu, {
                            triggerSelector: btn, // We'll assign id to btn if missing below
                            onClick: (e, dataset) => {
                                self.exportTo(dataset.format || 'xlsx', def.sheetname, def.filename);
                            }
                        });
                    }
                    else {
                        def.onClick = (api,ev,def) => {
                            self.exportTo(def.format || 'xlsx', def.sheetname, def.filename);
                        }
                    }
                }
                if (type === 'refresh') {
                    def.onClick = api => api.refresh();
                }

                if (typeof def.onClick === 'function') {
                    btn.addEventListener('click', ev => def.onClick(self.api(), ev, def));
                }

                actionsEl.appendChild(btn);
            });

            if (!actionsEl) return null;

            // Keep reference like before (if you used it)
            this.controlsActions = actionsEl;

            // Layout metadata (optional)
            const order = (!Array.isArray(raw) && raw && typeof raw.order === 'number') ? raw.order : 3;
            const align = (!Array.isArray(raw) && raw && raw.align) ? raw.align : undefined;

            return {
                key: 'buttons',
                el: actionsEl,
                order: order,
                align: align
            };
        }

        _initStructure() {
            var self = this;

            // Preserve existing THEAD/TH if present; only remove TBODY/TFOOT
            var existingThead = this.table.querySelector('thead');
            var existingHeaderRow = existingThead && existingThead.querySelector('tr');

            // Remove any old TBODY / TFOOT (we will recreate them)
            var oldTbody = this.table.querySelector('tbody');
            if (oldTbody && oldTbody.parentNode === this.table) {
                this.table.removeChild(oldTbody);
            }
            var oldTfoot = this.table.querySelector('tfoot');
            if (oldTfoot && oldTfoot.parentNode === this.table) {
                this.table.removeChild(oldTfoot);
            }

            // THEAD and header row
            var thead = existingThead || _dtCreateElement('thead');
            this.thead = thead;
            if (!existingThead) {
                this.table.appendChild(thead);
            }

            var headerRow = existingHeaderRow || _dtCreateElement('tr');
            var existingHeaderCells = [];
            if (!existingHeaderRow) {
                thead.appendChild(headerRow);
            } else {
                existingHeaderCells = Array.prototype.filter.call(headerRow.children, el=> el.tagName?.toLowerCase() === 'th');
            }

            // Optional selection header cell
            if (this.select.enabled) {
                var selTh = _dtCreateElement('th', TINY_TABLE_CLASSES.selectHeaderCell);

                var cb = _dtCreateElement('input', {type:'checkbox', 'data-tt-select-all': 1});
                //cb.dataset.ttSelectAll = '1';
                selTh.appendChild(cb);
                headerRow.appendChild(selTh);
                this._headerSelectCheckbox = cb;
            }

            // Merge column definitions with DOM <th> headers.
            // If there are more THs than columns, we synthesize extra columns.
            // If there are more columns than THs, we create missing THs.
            var maxLen = Math.max(this.columns.length, existingHeaderCells.length);
            var mergedColumns = [];
            for (var i = 0; i < maxLen; i++) {
                var originalCol = this.columns[i];
                var col = originalCol || {};
                var th = existingHeaderCells[i] || null;

                // Derive a key
                if (!col.key) {
                    col.key = col.data || th?.dataset.key;
                    if (!col.key) {
                        col.sortable = false;
                        col.searchable = false;
                    }
                }

                // Columns coming purely from DOM (no original definition)
                if (!originalCol) {
                    if (th && !col.title) {
                        col.title = th.textContent.trim();
                    }
                    if (th && !col.className && th.className) {
                        col.className = th.className;
                    }
                }

                mergedColumns[i] = col;
            }
            this.columns = mergedColumns;

            function _applyColumnStylePropsToEl(col, el, props) {
                props.forEach((p) => {
                    const v = col[p];
                    if (v == null || v === '') return;
                    // allow both camelCase and kebab-case in the whitelist
                    const jsProp = p.includes('-') ? p.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : p;
                    try {
                        el.style[jsProp] = String(v);
                    } catch (e) {
                        // ignore invalid style assignment
                    }
                });
            }

            function initHeaderCell(col, index) {
                if (col.visible === false) return;
                self.normalizeColumn(col, 'col', index);

                const existingTh = existingHeaderCells[index];
                const th = existingTh || _dtCreateElement('th');

                const hasDomTitle = !!(existingTh && (th.innerHTML.trim() || th.textContent.trim()));
                if (hasDomTitle) {
                    col.title = th.textContent.trim();
                } else if (col.title) {
                    th.textContent = col.title;
                } else if (col.html) {
                    th.innerHTML = col.html;
                }

                if (col.key) th.dataset.key = col.key;

                if (!isBlank(col.className)) {
                    var colClasses = tokenize_str(col.className);
                    _dtAddClass(th, colClasses);
                    col.className = colClasses;
                }

                if (col.sortable !== false) th.style.cursor = 'pointer';

                if (col.headerTooltip) th.setAttribute('data-tooltip', String(col.headerTooltip));

                // Apply column style props to the TH (no mutation of col)
                _applyColumnStylePropsToEl(col, th, COL_STYLE_PROPS);

                if (!existingTh) headerRow.appendChild(th);

                return th;
            }

            this.columns.forEach(initHeaderCell);

            thead.appendChild(headerRow);
            this.table.appendChild(thead);

            var tbody = _dtCreateElement('tbody');
            this.tbody = tbody;
            this.table.appendChild(tbody);

            var tfoot = _dtCreateElement('tfoot');
            this.tfoot = tfoot;
            this.table.appendChild(tfoot);

            if (this.footer.enabled) {
                const footerRow = _dtCreateElement('tr');
                this.footerRow = footerRow;

                // Selection column footer cell (empty)
                if (this.select.enabled) {
                    var selFoot = _dtCreateElement('th');
                    footerRow.appendChild(selFoot);
                }

                this.columns.forEach(function (col) {
                    if (col.visible === false) return;
                    var th = _dtCreateElement('th');
                    th.dataset.key = col.key;
                    footerRow.appendChild(th);
                });
                this.tfoot.appendChild(footerRow);
                this.tfoot.style.display = '';
            } else {
                this.tfoot.style.display = 'none';
            }

            // Build optional toolbar controls (filters + search + buttons)
            this._initControlsBar();
            /*
            // Build optional toolbar controls (filters bar and search input).
            var parentForControls = this.container || this.table.parentNode;
            var anchorForControls = this.wrapper || this.table;
            var hasFiltersUI = this.filters && this.filters.enabled &&
                Array.isArray(this.filters.items) && this.filters.items.length > 0;
            var hasSearchUI = this.searchConfig && this.searchConfig.enabled && this.searchConfig.selector!== '';

            if (parentForControls && (hasFiltersUI || hasSearchUI)) {
                var controls = _dtCreateElement('div', TINY_TABLE_CLASSES.controls);
                this.controlsContainer = controls;
                var self = this;

                // Filters bar
                if (hasFiltersUI) {
                    const filtersEl = _dtCreateElement('div', TINY_TABLE_CLASSES.filters);

                    // If there is NO search input, align filters to the right
                    //if (!hasSearchUI) {
                    //    filtersEl.classList.add('align-right');
                    //}

                    this.filters.items.forEach(function (def) {
                        if (!def || !def.key) return;

                        var item = _dtCreateElement('div', TINY_TABLE_CLASSES.filterItem, { class : self.customClass?.filterItem});
                        var labelEl = null;

                        if (def.label) {
                            labelEl = _dtCreateElement('label');
                            labelEl.textContent = String(def.label);
                            item.appendChild(labelEl);
                        }
                        if (def.tooltip) {
                            item.setAttribute("data-tooltip", String(def.tooltip));
                        }

                        let controlNode; // what we finally append to the item

                        if (def.type === 'bool') {
                            const switchLabel = _dtCreateElement('label', 'tt-switch');

                            const input = _dtCreateElement('input', { type : 'checkbox'});
                            input.checked = !!(self.state.filters && self.state.filters[def.key]);
                            switchLabel.appendChild(input);
                            const lever = _dtCreateElement('span', 'lever');
                            switchLabel.appendChild(lever);

                            input.addEventListener('change', function () {
                                if (!self.state.filters) self.state.filters = {};
                                self.state.filters[def.key] = !!this.checked;
                                self.state.page = 1;
                                self.draw();
                            });

                            // For this branch, the control to append is the whole switch label
                            controlNode = switchLabel;

                        } else {
                            // Default: <select> combobox with provided options
                            const opts = def.options || [];
                            const currentValue = (self.state.filters && self.state.filters[def.key] != null) ? String(self.state.filters[def.key]) : '';

                            const onFilterChange = function (e) {
                                var v = this.value;
                                if (!self.state.filters) self.state.filters = {};
                                self.state.filters[def.key] = (v === '' ? null : v);
                                self.state.page = 1;
                                self.draw();
                            }

                            controlNode = TinyDataTable.buildSelect(opts, currentValue, onFilterChange);
                            _dtAddClass(controlNode, self.customClass?.select);
                        }

                        if (def.id) controlNode.id = def.id;
                        if (def.name) controlNode.name = def.name;
                        if (labelEl && controlNode.id) {
                            labelEl.htmlFor = controlNode.id;
                        }

                        item.appendChild(controlNode);
                        filtersEl.appendChild(item);
                    });

                    controls.appendChild(filtersEl);
                }


                // Search input
                if (hasSearchUI) {
                    var searchEl = _dtCreateElement('div', TINY_TABLE_CLASSES.search);

                    var hasLabel = !isBlank(this.searchConfig?.label);
                    var inputId = this.id + '-search';

                    // Optional label
                    if (hasLabel) {
                        var labelEl = _dtCreateElement(
                            'label',
                            TINY_TABLE_CLASSES.searchLabel,
                            { text: this.searchConfig.label, for: inputId }
                        );
                        searchEl.appendChild(labelEl);
                    }

                    var inputEl = _dtCreateElement('input', TINY_TABLE_CLASSES.searchInput);
                    inputEl.type = 'search';
                    inputEl.placeholder = this.searchConfig.placeholder || '';
                    inputEl.value = this.state.searchText || '';

                    if (hasLabel) {
                        inputEl.id = inputId;
                    }

                    this._bindSearchInput(inputEl);

                    searchEl.appendChild(inputEl);
                    controls.appendChild(searchEl);
                }

                else if (this.searchConfig.selector) {
                    const inputEl = document.querySelector(this.searchConfig.selector);
                    if (!inputEl) {
                        console.warn('TinyDataTable: search.selector input not found:', this.searchConfig.selector);
                    } else {
                        this._bindSearchInput(inputEl);
                    }
                }

                parentForControls.insertBefore(controls, anchorForControls);

                // After filters/search are appended, or before—your choice.
                // Usually: render buttons at the end so they appear on the right.
                this._renderControlButtons(controls);

                // Initialize tooltips for static UI
                this._initTooltipsInScope(this.controlsContainer); /// ?? why here

             */

            if (this.paging.enabled) {
                var pagerContainer = _dtCreateElement('div', TINY_TABLE_CLASSES.pager, { class : this.customClass?.pager});

                this.pagerContainer = pagerContainer;

                var parentForPager = this.container || this.table.parentNode;
                var anchorForPager = this.wrapper || this.table;

                if (parentForPager && anchorForPager) {
                    parentForPager.insertBefore(pagerContainer, anchorForPager.nextSibling);
                }

                this.pager = new Pager(
                    this,
                    pagerContainer,
                    function () {
                        const page = self.state.page;
                        const pageSize = self.state.pageSize;
                        const totalRows= typeof self.state.totalRows === 'number' ? self.state.totalRows : 0;
                        const start = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
                        const end = totalRows === 0 ? 0 : Math.min(page * pageSize, totalRows);
                        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
                        return { page, pageSize, totalRows, totalPages, start, end };
                    },
                    function (newPage) {
                        self.goToPage(newPage);
                    },
                    function (newPageSize) {
                        var newSize = parseInt(newPageSize, 10);
                        var oldSize = self.state.pageSize;
                        if (newSize === oldSize) return;
                        self.state.pageSize = newSize;
                        self.state.page = 1;
                        self._emit('length', {
                            pageSize: newPageSize,
                            oldPageSize: oldSize
                        });
                        self.draw();
                    },
                    this.paging.pageSizeOptions
                );
            }

            // Header sort click (delegated)
            _addEventListener(this.thead, 'click', 'th', function (e, th) {
                // Ignore clicks on header select-all checkbox
                if (th.querySelector('input[type="checkbox"][data-tt-select-all="1"]')) return;

                const key = th.dataset.key;
                if (!key) return;

                var col = self.columns.find(function (c) { return c.key === key; });
                if (!col || col.sortable === false) return;

                // Shift+click => multi-sort append/promote. Normal click => single-sort.
                self.sortBy(key, { append: !!(e && e.shiftKey) });
            });

            // Header selection change (select all)
            this.thead.addEventListener('change', function (e) {
                var target = e.target;
                if (!target || target.type !== 'checkbox' || target.dataset.ttSelectAll !== '1') return;
                self._handleHeaderSelectAll(target.checked);
            });

            // Body click: toggle icon and optional row toggle
            if (this.childRows.enabled) {
                _addEventListener(this.tbody, 'click', 'tr.' + TINY_TABLE_CLASSES.rowHasChildren, function (e, tr) {
                    if (e.target.matches('input[type="checkbox"][data-tt-select]')) return false;
                    // `this` === row
                    if (self.childRows.toggleOnRowClick && this.dataset.rowKey) {
                        self.toggleChildRows(this.dataset.rowKey);
                        return;
                    }
                    return false;
                });
            }

            // Body selection change for row checkboxes (delegated)
            if (this.select.enabled) {
                _addEventListener(this.tbody, 'change', 'input[type="checkbox"][data-tt-select="row"]', function (e, checkbox) {
                    var tr = this.closest('tr');
                    if (tr && tr.dataset.rowKey) {
                        self._handleRowCheckboxChange(tr.dataset.rowKey, this.checked, tr);
                    }
                });
            }

            // Initialize tooltips for static UI
            this._initTooltipsInScope(this.thead);

            this._initRowActionDelegation();
        }
        _initRowActionDelegation() {
            var self = this; // table instance

            function onRowActionClick(e) {
                // e.currentTarget is the <a[data-action]>
                const a = e.currentTarget;

                const action = a.dataset.action;
                const tr = a.closest('tr');

                const payload = {
                    action,
                    dataset: { ...a.dataset },
                    rowKey: tr?.dataset?.rowKey ?? null,
                    id: tr?.dataset?.id ?? null,
                    rowData: tr?._data ?? null,
                    rowEl: tr,
                    event: e,          // wrapper, but delegates to original event
                    originalEvent: Object.getPrototypeOf(e) // optional if you want access
                };

                const actionEvent = camelCase(action);
                self._emit('action', payload);
                self._emit(`action:${actionEvent}`, payload);

                // if you want to block navigation:
                // e.preventDefault();
            }

            // keep a remover if you ever need to unbind
            this._offRowActionDelegation = _addEventListener(this.tbody, 'click', 'a[data-action]', onRowActionClick);
        }

        /**
         * Render a single "empty" row when there is no data to display.
         * @param {number} visibleColCount Total number of visible columns
         *                                 (already includes selection column if enabled)
         * @returns {HTMLTableRowElement}
         */
        _renderEmptyBody(visibleColCount) {
            const tr = _dtCreateElement('tr');
            const td = _dtCreateElement('td', TINY_TABLE_CLASSES.emptyCell);
            if (visibleColCount > 0) td.colSpan = visibleColCount;
            td.textContent = this.emptyMessage || 'No data available';
            tr.appendChild(td);
            return tr;
        }

        /**
         * Render grouped rows into a DocumentFragment.
         * @param {Array} rows
         * @param {number} visibleColCount
         * @returns {DocumentFragment}
         * @private
         */
        _renderGroupedBodyFragment(rows, visibleColCount, autoExpand) {
            var self = this;
            var frag = document.createDocumentFragment();

            var groups = this._buildGroups(rows);
            var mergeColsSet = new Set(this.grouping.mergeColumns || []);
            var pageRowCounter = 0;

            groups.forEach(function (group, groupIndex) {
                // Group header
                if (self.grouping.header && self.grouping.header.show) {
                    frag.appendChild(
                        self._renderGroupHeaderRow(group, groupIndex, visibleColCount)
                    );
                }

                group.rows.forEach(function (row, rowIndexInGroup) {
                    var rowKey = self._getRowKey(row, pageRowCounter, 'parent');
                    var hasChildren = self._hasChildRows(row);
                    var parentColumns = self._internals.visibleColumns || self.columns;
                    var childColumns = self._getChildColumnsForParent(row);
                    var isExpanded = self._expandedRowKeys.has(rowKey);

                    if (!self._pageGroupRowKeyMap[group.key]) {
                        self._pageGroupRowKeyMap[group.key] = [];
                    }
                    self._pageGroupRowKeyMap[group.key].push(rowKey);
                    self._pageParentRowKeys.push(rowKey);

                    var parentTr = self._renderDataRow(
                        row,
                        pageRowCounter,
                        rowKey,
                        false,
                        parentColumns,
                        {
                            hasChildren: hasChildren,
                            isExpanded: isExpanded,
                            mergeColumnsSet: mergeColsSet,
                            groupSize: group.rows.length,
                            rowIndexInGroup: rowIndexInGroup,
                            groupKey: group.key
                        }
                    );

                    parentTr.dataset.groupKey = group.key;

                    if (hasChildren) {
                        parentTr.classList.add(TINY_TABLE_CLASSES.rowHasChildren);
                        if (autoExpand && !self._expandedRowKeys.has(rowKey)) {
                            self._expandedRowKeys.add(rowKey);
                        }
                    }

                    frag.appendChild(parentTr);
                    pageRowCounter++;

                    var children = hasChildren ? self._getChildrenForRow(row) : null;
                    var expanded = self._expandedRowKeys.has(rowKey);

                    if (children && children.length && expanded) {
                        children.forEach(function (childRow, childIndex) {
                            var childKey = self._getRowKey(
                                childRow,
                                childIndex,
                                'child-of-' + rowKey
                            );
                            var childTr = self._renderDataRow(
                                childRow,
                                childIndex,
                                childKey,
                                true,
                                childColumns,
                                {
                                    hasChildren: false,
                                    isExpanded: false,
                                    mergeColumnsSet: null,
                                    groupSize: 1,
                                    rowIndexInGroup: 0,
                                    groupKey: group.key
                                }
                            );
                            childTr.classList.add(TINY_TABLE_CLASSES.childRow);
                            childTr.dataset.parentKey = rowKey;
                            frag.appendChild(childTr);
                        });
                    }
                });
            });

            return frag;
        }

        /**
         * Render non-grouped rows into a DocumentFragment.
         * @param {Array} rows
         * @returns {DocumentFragment}
         * @private
         */
        _renderFlatBodyFragment(rows, autoExpand) {
            var self = this;
            var frag = document.createDocumentFragment();

            rows.forEach(function (row, rowIndexOnPage) {
                var rowKey = self._getRowKey(row, rowIndexOnPage, 'parent');
                var hasChildren = self._hasChildRows(row);
                var parentColumns = self._internals.visibleColumns || self.columns;
                var childColumns = self._getChildColumnsForParent(row);
                var isExpanded = self._expandedRowKeys.has(rowKey);

                self._pageParentRowKeys.push(rowKey);

                var parentTr = self._renderDataRow(
                    row,
                    rowIndexOnPage,
                    rowKey,
                    false,
                    parentColumns,
                    {
                        hasChildren: hasChildren,
                        isExpanded: autoExpand || isExpanded,
                        mergeColumnsSet: null,
                        groupSize: 1,
                        rowIndexInGroup: 0,
                        groupKey: null
                    }
                );

                if (hasChildren) {
                    parentTr.classList.add(TINY_TABLE_CLASSES.rowHasChildren);
                    if (autoExpand && !self._expandedRowKeys.has(rowKey)) {
                        self._expandedRowKeys.add(rowKey);
                    }
                }

                frag.appendChild(parentTr);

                var children = hasChildren ? self._getChildrenForRow(row) : null;
                var expanded = self._expandedRowKeys.has(rowKey);

                if (children && children.length && expanded) {
                    children.forEach(function (childRow, childIndex) {
                        var childKey = self._getRowKey(
                            childRow,
                            childIndex,
                            'child-of-' + rowKey
                        );
                        var childTr = self._renderDataRow(
                            childRow,
                            childIndex,
                            childKey,
                            true,
                            childColumns,
                            {
                                hasChildren: false,
                                isExpanded: false,
                                mergeColumnsSet: null,
                                groupSize: 1,
                                rowIndexInGroup: 0,
                                groupKey: null
                            }
                        );
                        childTr.classList.add(TINY_TABLE_CLASSES.childRow);
                        childTr.dataset.parentKey = rowKey;
                        frag.appendChild(childTr);
                    });
                }
            });

            return frag;
        }

        /**
         * Unfortunaly, the render(value) is not possible anymore
         */
        _renderValue(col, rawValue, row, index, phase, extraCtx) {
            // No renderer => raw value
            if (!col || typeof col.render !== "function") return rawValue;

            const _makeRenderCtx = (phase, col, row, rowIndex, extra) => {
                return Object.assign({
                    phase: phase,
                    column: col,
                    rowKey: row ? row.key : null,
                    rowIndex: rowIndex,
                    isChild: false,
                    _esc: escapeHtml,
                    _html: html => ({ html: String(html) }),
                    _blank : isBlank
                }, extra || {});
            }

            // Build ctx once
            const ctx = _makeRenderCtx(phase || "value", col, row, index, extraCtx);

            // New API payload
            const payload = { value: rawValue, row: row, index: index, ctx: ctx };

            try {
                // If renderer declares <= 1 param, assume new API: render({ value, row, index, ctx })
                // Legacy API: render(value, row, index, ctx)
                return col.render.length <= 1 ? col.render.call(this, payload) : col.render.call(this, rawValue, row, index, ctx);
            } catch (e) {
                return rawValue;
            }
        }

        /**
         * Main body renderer – determines a single child (fragment or row),
         * then appends it once to a new fragment.
         * @param {Array} rows Page rows to render
         */
        _renderBody(rows) {
            var visibleColCount = this._internals.visibleColumnCount;
            var child;

            // Only auto-expand on the very first render (or after explicit reset)
            var autoExpand = this.childRows && this.childRows.enabled &&
                this.childRows.startExpanded && !this._childRowsInitialized;

            if (rows && rows.length) {

                var hasGrouping = this._hasGrouping();

                // Reset per-page caches (used by selection + grouping)
                this._pageParentRowKeys = [];
                if (hasGrouping) {
                    this._pageGroupRowKeyMap = {};
                    child = this._renderGroupedBodyFragment(rows, visibleColCount, autoExpand); // DocumentFragment
                } else {
                    child = this._renderFlatBodyFragment(rows, autoExpand); // DocumentFragment
                }
            } else {
                child = this._renderEmptyBody(visibleColCount); // <tr>
            }

            var frag = document.createDocumentFragment();
            // Works for both: DocumentFragment and HTMLElement are Nodes
            frag.appendChild(child);

            this.tbody.replaceChildren(frag);

            // After first auto-expand render, avoid re-forcing expansion on future renders
            if (autoExpand) {
                this._childRowsInitialized = true;
            }
        }

        /**
         * Operations that should run after the body has been rendered.
         * This is shared between a full draw() and a fast re-render.
         * @param {Array} pageRows Current page rows
         * @private
         */
        _postBodyRender(pageRows) {
            // Re-apply highlighting only when the query changed (mark.js is expensive on large tables)
            if (this.highlight && this.highlight.enabled) {
                var q = (this.state.searchText || '').trim();
                if (q !== this._internals.lastHighlightQuery) {
                    this._applyHighlight();
                    this._internals.lastHighlightQuery = q;
                }
            }

            // Sync row checkboxes + header checkbox with selection state
            this._syncSelectionDomAndHeader();
        }

        /**
         * Fast path: re-render only the tbody using the last loaded page rows.
         * Does NOT hit the data source, does NOT touch pager/footer.
         * Used for child row expand/collapse where data is unchanged.
         * @private
         */
        _rerenderBodyOnly() {
            // If we have no cached rows yet (first draw not done), fall back to full draw.
            if (!Array.isArray(this._lastPageRows)) {
                this.draw();
                return;
            }

            // Rebuild body based on current expand/collapse state and cached page rows
            this._renderBody(this._lastPageRows);

            // Minimal post-render work: highlight + selection sync
            this._postBodyRender(this._lastPageRows);
        }

        _addCustomClasses(tr, classes) {
            if (!classes) return;

            // allow string or array
            if (typeof classes === 'string') {
                classes = classes.trim().split(/\s+/);
            }
            if (!Array.isArray(classes)) return;

            classes.forEach(function (c) {
                if (c && typeof c === 'string') {
                    tr.classList.add(c);
                }
            });
        }

        /**
         * kind: 'row' | 'childRow' | 'groupRow'
         * cfg:  string | string[] | function(data, meta)
         */
        _applyCustomClass(tr, kind, data, meta) {
            if (!this.customClass) return;

            var cfg = this.customClass[kind];
            if (!cfg) return;

            var classes = (typeof cfg === 'function')
                ? cfg(data, meta || {})
                : cfg;

            this._addCustomClasses(tr, classes);
        }

        _applyRowCustomClass(tr, row, meta) {
            if (!this.customClass) return;

            var kind;
            if (meta && meta.isGroupHeader) {
                kind = 'groupRow';
            } else if (meta && meta.isChild) {
                kind = 'childRow';
            } else {
                kind = 'row';
            }

            this._applyCustomClass(tr, kind, row, meta);
        }


        _renderDataRow(row, index, rowKey, isChild, columns, meta) {
            const tr = _dtCreateElement('tr');
            tr.dataset.rowKey = rowKey;
            tr._data = row;

            if (isChild) {
                tr.classList.add(TINY_TABLE_CLASSES.childRow);
            } else {
                this._rowDataByKey[rowKey] = row;  // Store row data for selection API (parents only)
            }

            var visibleIndex = 0;
            var self = this;

            // Count how many cells we actually render for this row (select + data cells)
            var renderedCellCount = 0;

            // Selection column:
            // - Parent rows: checkbox or group-level selection cell
            // - Child rows: empty cell to keep alignment
            if (this.select && this.select.enabled) {
                if (!isChild) {
                    var selTd = this._renderSelectCell(row, rowKey, meta);
                    if (selTd) {
                        tr.appendChild(selTd);
                        renderedCellCount++;
                    }
                } else {
                    // Child row: keep same grid position with an empty select cell
                    var emptySelTd = _dtCreateElement('td', TINY_TABLE_CLASSES.selectCell);
                    tr.appendChild(emptySelTd);
                    renderedCellCount++;
                }
            }

            // Data cells for each visible column (for parent or child)
            columns.forEach(function (col) {
                if (col.visible === false) return;

                var isFirstVisible = (self.select && self.select.enabled ? visibleIndex === 0 : visibleIndex === 0);

                var cellMeta = {
                    isFirstVisible: isFirstVisible,
                    hasChildren: meta && meta.hasChildren,
                    isExpanded: meta && meta.isExpanded,
                    mergeColumnsSet: meta && meta.mergeColumnsSet,
                    groupSize: meta && meta.groupSize,
                    rowIndexInGroup: meta && meta.rowIndexInGroup
                };

                var td = self._renderCell(row, col, index, isChild, rowKey, cellMeta);
                if (td) {
                    tr.appendChild(td);
                    renderedCellCount++;
                }

                visibleIndex++;
            });

            // Total number of visible columns for this table, including select column
            if (isChild) {
                const expectedVisibleCols = this._internals.visibleColumnCount;
                // If this is a child row and it has fewer cells than the table's visible column count,
                // pad the remainder with empty cells so the grid stays aligned.
                if (renderedCellCount < expectedVisibleCols) {
                    const missing = expectedVisibleCols - renderedCellCount;
                    for (let i = 0; i < missing; i++) {
                        tr.appendChild(_dtCreateElement('td', TINY_TABLE_CLASSES.emptyCell));
                    }
                }
            }

            meta.isChild = !!isChild;
            this._applyRowCustomClass(tr, row, meta);

            if (this.options && typeof this.options.createdRow === 'function') {
                this.options.createdRow(tr, row, index);
            }

            return tr;
        }

        _renderSelectCell(row, rowKey, meta) {
            var groupMode = (this._hasGrouping() && this.select.groupMode === 'group') ? 'group' : 'row';
            var groupSize = meta && meta.groupSize;
            var rowIndexInGroup = meta && meta.rowIndexInGroup;

            // For group mode, only first row of group gets the merged checkbox
            if (groupMode === 'group' &&
                typeof rowIndexInGroup === 'number' &&
                rowIndexInGroup > 0 &&
                groupSize > 1) {
                return null;
            }

            var td = _dtCreateElement('td', TINY_TABLE_CLASSES.selectCell);


            if (groupMode === 'group' &&
                typeof rowIndexInGroup === 'number' &&
                rowIndexInGroup === 0 &&
                groupSize > 1) {
                td.rowSpan = groupSize;
            }

            var input = _dtCreateElement('input');
            input.type = 'checkbox';
            input.dataset.ttSelect = 'row';
            input.checked = this._selectedRowKeys.has(rowKey);

            td.appendChild(input);
            return td;
        }

        _parseNode(html) {
            if (!this.domParser) this.domParser = new DOMParser();
            try {
                const doc = this.domParser.parseFromString(html, 'text/html');
                return doc.body.firstChild;
            } catch(e) {
            }
        }

        _renderCell(row, col, index, isChild, rowKey, meta) {
            var mergeColsSet = meta && meta.mergeColumnsSet;
            var groupSize = meta && meta.groupSize;
            var rowIndexInGroup = meta && meta.rowIndexInGroup;

            // If this column is merged and this is not the first row of the group, skip the cell
            if (!isChild &&
                mergeColsSet &&
                mergeColsSet.has(col.key) &&
                typeof rowIndexInGroup === 'number' &&
                rowIndexInGroup > 0 &&
                groupSize > 1) {
                return null;
            }

            var td = _dtCreateElement('td');
            if (col.className?.length) {
                _dtAddClass(td,col.className)
            }

            // If this column is merged and this is the first row of the group, set rowspan
            if (!isChild &&
                mergeColsSet &&
                mergeColsSet.has(col.key) &&
                typeof rowIndexInGroup === 'number' &&
                rowIndexInGroup === 0 &&
                groupSize > 1) {
                td.rowSpan = groupSize;
            }

            if (!isChild &&
                this.childRows.enabled &&
                this.childRows.showToggleIcon &&
                meta &&
                meta.isFirstVisible &&
                meta.hasChildren) {
                var icon = _dtCreateElement('span', TINY_TABLE_CLASSES.toggleIcon);


                icon.dataset.ttToggle = 'row';

                if (meta.isExpanded) icon.classList.add('expanded');

                td.appendChild(icon);
                td.appendChild(document.createTextNode(' '));
            }

            var rawValue = row[col.key];

            // Tooltip for cell
            if (col.tooltip) {
                var tip = (typeof col.tooltip === "function")
                    ? col.tooltip(row, rawValue, { rowKey: rowKey, rowIndex: index, isChild: !!isChild })
                    : col.tooltip;
                if (tip != null && tip !== "") {
                    td.setAttribute("data-tooltip", String(tip));
                }
            }

            var content = this._renderValue(col, rawValue, row, index, "display", {
                isChild: !!isChild,
                rowKey: rowKey,
                td: td
            });

            if (content!=null) {
                var node;
                if (content instanceof Node) {
                    td.appendChild(content);
                } else if (typeof content === 'object' && content.html!=null) {
                    td.innerHTML = content.html; // = this._parseNode(content.html);
                } else
                    td.appendChild(document.createTextNode(content != null ? String(content) : ''));
            }

            return td;
        }

        _updateSortIndicators() {
            if (!this.thead) return;

            const orders = Array.isArray(this.state.sortOrders) ? this.state.sortOrders : [];
            const hasMultiSort = orders.length > 1;

            // Build lookup: key -> { dir, rank }
            const map = Object.create(null);
            for (let i = 0; i < orders.length; i++) {
                const o = orders[i];
                if (!o || !o.key) continue;
                const dir = String(o.dir || o.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
                map[o.key] = { dir, rank: i + 1 };
            }

            this.thead.querySelectorAll('th').forEach(th => {
                th.classList.remove(TINY_TABLE_CLASSES.sortedAsc, TINY_TABLE_CLASSES.sortedDesc);

                // Remove rank marker if previously set
                if (th.dataset && th.dataset.sortRank) delete th.dataset.sortRank;

                const key = th.getAttribute('data-key') || th.dataset.key;
                if (!key) return;

                const info = map[key];
                if (info) {
                    th.classList.add(info.dir === 'asc' ? TINY_TABLE_CLASSES.sortedAsc : TINY_TABLE_CLASSES.sortedDesc);
                    // Expose rank (1 = primary, 2+ = secondary)
                    if (hasMultiSort) {
                        th.dataset.sortRank = String(info.rank);
                    } else if (th.dataset.sortRank) {
                        delete th.dataset.sortRank;
                    }
                }
            });
        }

        _getAllVisibleRowsForAggregates(pageRows) {
            if (!this.footer?.enabled) return null;

            const aggs = this.footer.aggregates;
            const hasAggregates =
                aggs && !Array.isArray(aggs) && typeof aggs === 'object' && Object.keys(aggs).length > 0;

            if (!hasAggregates) return null;

            // Local mode: aggregate on all filtered rows (not just current page)
            if (this.dataSource instanceof LocalDataSource &&
                typeof this.dataSource.getFilteredRows === 'function') {
                return this.dataSource.getFilteredRows(this.state, this.columns);
            }

            // Ajax mode: fallback to current page only (unless server provides aggregates separately)
            return Array.isArray(pageRows) ? pageRows : [];
        }


        _updateFooterAggregates(allRows) {
            const self = this;
            if (!this.footer?.enabled || !this.footerRow) return;

            const aggregates =
                this.footer.aggregates &&
                !Array.isArray(this.footer.aggregates) &&
                typeof this.footer.aggregates === 'object'
                    ? this.footer.aggregates
                    : {};

            const aggKeys = Object.keys(aggregates);

            const getFooterCells = () => this.footerRow.querySelectorAll('th');
            const getVisibleStartIndex = () => (this.select?.enabled ? 1 : 0);

            const clearFooter = () => {
                const cells = getFooterCells();
                let idx = getVisibleStartIndex();

                this.columns.forEach(col => {
                    if (col.visible === false) return;
                    const cell = cells[idx++];
                    if (cell) cell.textContent = '';
                });
            };

            const collectValuesByKey = (rows, keys) => {
                const map = {};
                keys.forEach(k => (map[k] = []));

                rows.forEach(row => {
                    if (!row) return;
                    keys.forEach(k => map[k].push(row[k]));
                });

                return map;
            };

            const resolveAggregator = (def) => {
                if (typeof def === 'function') return def;
                const name = String(def);
                return TinyDataTable.aggregators?.[name];
            };

            const computeAggregates = (valuesByKey) => {
                const results = {};

                aggKeys.forEach(k => {
                    const fn = resolveAggregator(aggregates[k]);

                    if (typeof fn !== 'function') {
                        console.warn(
                            'TinyDataTable: unknown footer aggregator:',
                            aggregates[k],
                            'for column:',
                            k
                        );
                        results[k] = null;
                        return;
                    }

                    try {
                        results[k] = fn(valuesByKey[k] || [], {
                            key: k,
                            rows: allRows,
                            table: self
                        });
                    } catch (e) {
                        results[k] = null;
                    }
                });

                return results;
            };

            const renderFooterCell = (col, value, cell) => {
                let v = value;

                if (typeof col.render === 'function') {
                    try {
                        v = self._renderValue(col, v, null, -1, 'footer', {
                            td: cell,
                            rowKey: col.key,
                            isChild: false
                        });
                    } catch (e) {}
                }

                cell.textContent = (v == null) ? '' : String(v);
            };

            // ---- main flow ----

            if (!aggKeys.length || !Array.isArray(allRows) || !allRows.length) {
                clearFooter();
                return;
            }

            // Only aggregate visible columns
            const visibleAggKeys = aggKeys.filter(k =>
                this.columns.some(col => col.key === k && col.visible !== false)
            );

            if (!visibleAggKeys.length) {
                clearFooter();
                return;
            }

            const valuesByKey = collectValuesByKey(allRows, visibleAggKeys);
            const results = computeAggregates(valuesByKey);

            const cells = getFooterCells();
            let idx = getVisibleStartIndex();

            this.columns.forEach(col => {
                if (col.visible === false) return;

                const cell = cells[idx++];
                if (!cell) return;

                if (Object.prototype.hasOwnProperty.call(results, col.key)) {
                    renderFooterCell(col, results[col.key], cell);
                } else {
                    cell.textContent = '';
                }
            });
        }

        _applyHighlight() {
            if (!MARK_CTOR || !this.highlight.enabled) return;
            const keyword = this.state.searchText?.trim();
            if (!keyword) return;

            let context = this.tbody;
            if ( this.highlight.contextSelector &&  this.highlight.contextSelector !=='tbody') {
                context = this.table.querySelector(this.highlight.contextSelector);
                if (!context) return;
            }

            const instance = new MARK_CTOR(context);
            const markOptions = this.highlight.markOptions || {};

            try {
                instance.unmark({
                    done: function () {
                        instance.mark(keyword, markOptions);
                    }
                });
            } catch (e) {
                try {
                    instance.unmark();
                    instance.mark(keyword, markOptions);
                } catch (e2) {
                    // ignore
                }
            }
        }

        _handleRowCheckboxChange(rowKey, checked, tr) {
            var mode = (this._hasGrouping() && this.select.groupMode === 'group') ? 'group' : 'row';
            var affectedKeys = [];
            var self = this;

            if (mode === 'group') {
                var groupKey = tr && tr.dataset.groupKey;
                if (groupKey && this._pageGroupRowKeyMap && this._pageGroupRowKeyMap[groupKey]) {
                    affectedKeys = this._pageGroupRowKeyMap[groupKey].slice();
                } else {
                    affectedKeys = [rowKey];
                }
            } else {
                affectedKeys = [rowKey];
            }

            affectedKeys.forEach(function (k) {
                if (checked) {
                    self._selectedRowKeys.add(k);
                } else {
                    self._selectedRowKeys.delete(k);
                }
            });

            this._syncSelectionDomAndHeader();

            this._emit('select', {
                mode: mode,
                rowKey: rowKey,
                checked: checked,
                affectedRowKeys: affectedKeys.slice(),
                selectedRowKeys: this.getSelectedRowKeys()
            });
        }

        _handleHeaderSelectAll(checked) {
            var self = this;
            if (!this._pageParentRowKeys) return;
            this._pageParentRowKeys.forEach(function (k) {
                if (checked) {
                    self._selectedRowKeys.add(k);
                } else {
                    self._selectedRowKeys.delete(k);
                }
            });
            this._syncSelectionDomAndHeader();

            this._emit('select', {
                mode: 'page',
                rowKey: null,
                checked: checked,
                affectedRowKeys: this._pageParentRowKeys.slice(),
                selectedRowKeys: this.getSelectedRowKeys()
            });
        }

        _updateHeaderSelectCheckboxState() {
            var cb = this._headerSelectCheckbox;
            if (!cb || !this._pageParentRowKeys) return;

            var total = this._pageParentRowKeys.length;
            if (total === 0) {
                cb.checked = false;
                cb.indeterminate = false;
                return;
            }

            var selectedCount = 0;
            var self = this;
            this._pageParentRowKeys.forEach(function (k) {
                if (self._selectedRowKeys.has(k)) selectedCount++;
            });

            if (selectedCount === 0) {
                cb.checked = false;
                cb.indeterminate = false;
            } else if (selectedCount === total) {
                cb.checked = true;
                cb.indeterminate = false;
            } else {
                cb.checked = false;
                cb.indeterminate = true;
            }
        }

        _syncSelectionDomAndHeader() {
            if (!this.select.enabled) return;

            var body = this.tbody;
            if (body) {
                var inputs = body.querySelectorAll('input[type="checkbox"][data-tt-select="row"]');
                for (var i = 0; i < inputs.length; i++) {
                    var cb = inputs[i];
                    var tr = cb.closest('tr');
                    if (!tr) continue;
                    var key = tr.dataset.rowKey;
                    cb.checked = key && this._selectedRowKeys.has(key);
                }
            }

            this._updateHeaderSelectCheckboxState();
        }

        exportTo(format, ...args) {
            if (!format) throw new Error('exportTo(format, ...) requires a format');
            const exporter = TinyDataTable.exporters?.[format.toLowerCase()];
            if (!exporter) throw new Error(`No exporter registered for format "${format}", did you import the TinyDataTable.export.js file ?`);
            return exporter.export(this, ...args);
        };
    }

    // -----------------------------
    // Pager helper class
    // -----------------------------

    class Pager {
        /**
         * @param {HTMLElement} container
         * @param {Function} getState        () => { page, pageSize, totalRows }
         * @param {Function} onPageChange    (newPage)
         * @param {Function} onPageSizeChange(newPageSize)
         * @param {number[]} pageSizeOptions
         */
        constructor(table, container, getState, onPageChange, onPageSizeChange, pageSizeOptions) {
            this.table = table;
            this.container = container;
            this.getState = getState;
            this.onPageChange = onPageChange;
            this.onPageSizeChange = onPageSizeChange;
            this.pageSizeOptions = pageSizeOptions ?? [10, 25, 50, 100];
            this.texts = table.texts;
            this.init();
        }

        /**
         * Initialize table structure and perform initial draw.
         * This is automatically called by the constructor.
         */

        init() {
            const state = this.getState();
            const maxPage = Math.max(1, Math.ceil(state.totalRows / state.pageSize));

            this.container.appendChild(this._buildPageSize(state));
            this.container.appendChild(this._buildPageInfo());

            var pagination = _dtCreateElement('div', TINY_TABLE_CLASSES.pages);
            this.container.appendChild(pagination);
            this.pagination = pagination;
            this._initPaginationShell();
            this._updatePageNumberList(); // first render
        }

        _buildPageSize(state) {
            var self = this;

            var lengthWrapper = _dtCreateElement('div', TINY_TABLE_CLASSES.length);

            var lengthLabel = _dtCreateElement('span', { text : this.texts.pagerShowPrefix || 'Show '});

            var pageSize = state.pageSize;
            // Ensure the pageSize is part of the pageSizeOptions array
            if (!this.pageSizeOptions.includes(pageSize)) {
                this.pageSizeOptions.push(pageSize);
                this.pageSizeOptions.sort((a, b) => a - b);  // Sort the array numerically
            }

            const onLengthChange = function () {
                //const selectedValue = event.target.value;
                var newSize = parseInt(this.value, 10) || pageSize;
                self.onPageSizeChange(newSize);
            }

            const lengthSelect = TinyDataTable.buildSelect(this.pageSizeOptions, pageSize, onLengthChange);
            _dtAddClass(lengthSelect, this.table.customClass?.select);

            var lengthSuffix = _dtCreateElement('span', { text : this.texts.pagerEntriesSuffix || ' entries'});

            lengthWrapper.appendChild(lengthLabel);
            lengthWrapper.appendChild(lengthSelect);
            lengthWrapper.appendChild(lengthSuffix);

            this.pageLengthSelect = lengthSelect;

            return lengthWrapper;
        }

        // Update page info
        _updatePageInfo() {
            const {start, end, totalRows} = this.getState();
            const tpl = this.texts.pagerInfo || 'Showing {start} to {end} of {total} entries';
            this.pageInfo.textContent = totalRows>0 ? formatText(tpl, { start, end, total: totalRows }) : '';
        }

        _buildPageInfo() {
            this.pageInfo = _dtCreateElement('div', TINY_TABLE_CLASSES.info);
            this._updatePageInfo();
            return this.pageInfo;
        }

        // Update pager components
        /**
         * Update options/state and re-draw.
         * Intended for small incremental updates (for larger changes, rebuild the table).
         * @param {Object} newOptions
         */

        update() {
            this._updatePageNumberList();
            this._updatePageInfo();
        }

        _createButton(label, opts) {
            opts = opts || {};
            const btn = _dtCreateElement('button', { type: 'button' });

            // label can be string/number or { html }
            if (label && typeof label === 'object' && label.html != null) {
                btn.innerHTML = label.html;
            } else {
                btn.textContent = label != null ? String(label) : '';
            }

            if (opts.activeClass) btn.classList.add(opts.activeClass);
            if (opts.disabled) btn.disabled = true;

            if (typeof opts.onClick === 'function') {
                btn.addEventListener('click', opts.onClick);
            }

            return btn;
        }

        _initPaginationShell() {
            const self = this;
            const pagination = this.pagination;
            pagination.innerHTML = '';

            this._btnFirst = this._createButton(this.texts.pagerFirst || '«', {
                onClick: () => self.onPageChange(1)
            });

            this._btnPrev = this._createButton(this.texts.pagerPrev || '‹', {
                onClick: () => {
                    const { page } = self.getState();
                    self.onPageChange(page - 1);
                }
            });

            this._btnNext = this._createButton(this.texts.pagerNext || '›', {
                onClick: () => {
                    const { page } = self.getState();
                    self.onPageChange(page + 1);
                }
            });

            this._btnLast = this._createButton(this.texts.pagerLast || '»', {
                onClick: () => {
                    const { totalPages } = self.getState();
                    self.onPageChange(totalPages);
                }
            });

            this._pagesSlot = _dtCreateElement('span', TINY_TABLE_CLASSES.pagesSlot);

            pagination.appendChild(this._btnFirst);
            pagination.appendChild(this._btnPrev);
            pagination.appendChild(this._pagesSlot);
            pagination.appendChild(this._btnNext);
            pagination.appendChild(this._btnLast);
        }

        _renderPageItemsIntoSlot(currentPage, items) {
            const self = this;
            const slot = this._pagesSlot;
            slot.innerHTML = '';

            items.forEach(function (item) {
                if (item.type === 'page') {
                    const isActive = item.number === currentPage;

                    slot.appendChild(self._createButton(item.number, {
                        disabled: isActive,
                        activeClass: isActive ? TINY_TABLE_CLASSES.pageButtonActive : null,
                        onClick: isActive ? null : () => self.onPageChange(item.number)
                    }));
                } else {
                    slot.appendChild(
                        _dtCreateElement('span', TINY_TABLE_CLASSES.ellipsis, {
                            text: self.texts.pagerEllipsis || '…'
                        })
                    );
                }
            });
        }

        _updatePageNumberList() {
            const { page, totalPages } = this.getState();

            this._btnFirst.disabled = page <= 1;
            this._btnPrev.disabled  = page <= 1;
            this._btnNext.disabled  = page >= totalPages;
            this._btnLast.disabled  = page >= totalPages;

            // build items (your existing logic)
            const items = [];
            if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) items.push({ type: 'page', number: i });
            } else {
                items.push({ type: 'page', number: 1 });
                let left = Math.max(2, page - 1);
                let right = Math.min(totalPages - 1, page + 1);
                if (left > 2) items.push({ type: 'ellipsis' });
                for (let i = left; i <= right; i++) items.push({ type: 'page', number: i });
                if (right < totalPages - 1) items.push({ type: 'ellipsis' });
                items.push({ type: 'page', number: totalPages });
            }

            this._renderPageItemsIntoSlot(page, items);
        }

    }

    class Popup {
        /**
         * @param {string|HTMLElement} popupSelector - Popup container selector or element.
         * @param {Object} options
         * @param {string|string[]} options.triggerSelector - CSS selector(s) for triggers that open this popup.
         * @param {function} options.onClick - Callback invoked on item click, (event, dataset) => {}
         */
        constructor(popupSelector, { triggerSelector, onClick }) {
            this.popup = typeof popupSelector === 'string'
                ? document.querySelector(popupSelector)
                : popupSelector;

            if (!this.popup) {
                throw new Error('Popup element not found');
            }

            if (triggerSelector instanceof Node) {
                this.triggers = [triggerSelector];
            } else if (
                NodeList.prototype.isPrototypeOf(triggerSelector) ||
                HTMLCollection.prototype.isPrototypeOf(triggerSelector) ||
                Array.isArray(triggerSelector)
            ) {
                // Array-like collection of nodes
                this.triggers = Array.from(triggerSelector);
            } else if (typeof triggerSelector === 'string') {
                this.triggers = Array.from(document.querySelectorAll(triggerSelector));
            } else {
                throw new Error('triggerSelector must be a CSS selector string, Node, or array/NodeList of Nodes');
            }

            if (!this.triggers.length) {
                throw new Error('No triggers found for popup');
            }

            if (typeof onClick !== 'function') {
                throw new Error('onClick callback is required');
            }

            this.onClick = onClick;
            this.isVisible = false;
            this.boundDocClick = this.handleDocumentClick.bind(this);

            this.init();
        }

        init() {
            // Bind triggers click
            this.triggers.forEach(trigger => {
                trigger.addEventListener('click', e => {
                    e.preventDefault();
                    this.toggle(trigger);
                });
            });

            // Bind clicks inside popup items
            this.popup.addEventListener('click', e => {
                const item = e.target.closest('li');
                if (item && this.popup.contains(item)) {
                    this.onClick(e, item.dataset);
                    this.hide();
                }
            });
        }

        show(trigger) {
            if (this.isVisible) return;

            this.popup.classList.add('invisible');
            this.positionPopup(trigger);
            this.popup.classList.remove('invisible');
            this.popup.classList.add('visible');

            this.isVisible = true;

            // Listen for clicks outside to close
            document.addEventListener('click', this.boundDocClick);
        }

        hide() {
            if (!this.isVisible) return;

            this.popup.classList.remove('visible');
            this.isVisible = false;

            document.removeEventListener('click', this.boundDocClick);
        }

        toggle(trigger) {
            if (this.isVisible) {
                this.hide();
            } else {
                this.show(trigger);
            }
        }

        positionPopup(trigger) {
            if (!trigger || !this.popup) return;

            // The popup's offset parent (could be the container with relative position)
            const offsetParent = this.popup.offsetParent || document.body;

            // Get bounding rects relative to viewport
            const triggerRect = trigger.getBoundingClientRect();
            const parentRect = offsetParent.getBoundingClientRect();

            // Calculate position relative to offset parent
            let top = triggerRect.bottom - parentRect.top;
            let left = triggerRect.left - parentRect.left;

            const popupWidth = this.popup.offsetWidth || 200;
            const parentWidth = this.popup.offsetParent ? this.popup.offsetParent.clientWidth : window.innerWidth;
            if (left + popupWidth > parentWidth) {
                left = Math.max(0, parentWidth - popupWidth - 10);
            }

            this.popup.style.position = 'absolute';
            this.popup.style.top = `${top}px`;
            this.popup.style.left = `${left}px`;
            this.popup.style.minWidth = `${triggerRect.width}px`;
            this.popup.style.zIndex = 1000;
        }



        handleDocumentClick(e) {
            if (
                !this.popup.contains(e.target) &&
                !this.triggers.some(trigger => trigger.contains(e.target))
            ) {
                this.hide();
            }
        }
    }

    // -----------------------------
    // i18n defaults (texts)
    // -----------------------------

    TinyDataTable.defaults = TinyDataTable.defaults || {};

    TinyDataTable.defaults.texts = Object.assign({
        emptyMessage: "No data available",
        searchPlaceholder: "Search...",
        pagerShowPrefix: "Show ",
        pagerEntriesSuffix: " entries",
        pagerInfo: "Showing {start} to {end} of {total} entries",
        pagerFirst: "«",
        pagerPrev: "‹",
        pagerNext: "›",
        pagerLast: "»",
        pagerEllipsis: "…",

        exportButton: {
            label: (fmt) => {
                const labels = {
                    xlsx: 'Excel (.xlsx)',
                    pdf: 'PDF Document',
                    csv: 'CSV File',
                };
                return labels[fmt];
            }
        }
    }, TinyDataTable.defaults.texts || {});

    // Pager end

    // Expose a way to override mark.js constructor if needed
    TinyDataTable.setMarkConstructor = function (ctor) {
        MARK_CTOR = ctor || null;
    };

    TinyDataTable.setTooltipAdapter = function (fn) {
        if (fn != null && typeof fn !== 'function') {
            const isObj = (typeof fn === 'object' && (typeof fn.bind === 'function' || typeof fn.delegate === 'function'));
            if (!isObj) {
                throw new Error("Tooltip adapter must be a function, an object { bind, delegate }, or null.");
            }
        }
        GLOBAL_TOOLTIP_ADAPTER = fn;
    };


    TinyDataTable.typeRenderers = {
        digits({value, ctx}) {
            if (ctx._blank(value)) return '';
            if (ctx.phase == 'display') {
                return to_digits(value,this.locale);
            }
            return value;
        },
        ngdigits({value, ctx}) {
            if (ctx._blank(value)) return '';
            if (ctx.phase == 'display') {
                var num = Number(value);
                if (!Number.isNaN(num)) return to_digits(value,this.locale);
            }
            return value;
        },
        percent({value, ctx}) {
            if (ctx._blank(value)) return '';
            if (ctx.phase == 'display') {
                var num = Number(value);
                if (!Number.isNaN(num)) return num.toFixed(1) + ' %';
            }
            return value;
        }
    };

    TinyDataTable.appendTypeRenderers = function (renderers) {
        TinyDataTable.typeRenderers = Object.assign({}, TinyDataTable.typeRenderers, renderers);
    };

    TinyDataTable.aggregators = {

        /* ---------- BASIC ---------- */

        sum(values) {
            let s = 0;
            for (const v of values) {
                const n = Number(v);
                if (Number.isFinite(n)) s += n;
            }
            return s;
        },

        avg(values) {
            let s = 0, c = 0;
            for (const v of values) {
                const n = Number(v);
                if (Number.isFinite(n)) {
                    s += n;
                    c++;
                }
            }
            return c ? (s / c) : null;
        },

        min(values) {
            let m = null;
            for (const v of values) {
                const n = Number(v);
                if (!Number.isFinite(n)) continue;
                m = (m === null) ? n : Math.min(m, n);
            }
            return m;
        },

        max(values) {
            let m = null;
            for (const v of values) {
                const n = Number(v);
                if (!Number.isFinite(n)) continue;
                m = (m === null) ? n : Math.max(m, n);
            }
            return m;
        },

        /* ---------- COUNTING ---------- */

        count(values) {
            return values.length;
        },

        countNonNull(values) {
            let c = 0;
            for (const v of values) {
                if (v != null && v !== '') c++;
            }
            return c;
        },

        countDistinct(values) {
            const set = new Set();
            for (const v of values) {
                if (v != null) set.add(v);
            }
            return set.size;
        },

        /* ---------- STATISTICAL ---------- */

        median(values) {
            const arr = values
                .map(v => Number(v))
                .filter(n => Number.isFinite(n))
                .sort((a, b) => a - b);

            if (!arr.length) return null;

            const mid = Math.floor(arr.length / 2);
            return (arr.length % 2)
                ? arr[mid]
                : (arr[mid - 1] + arr[mid]) / 2;
        },

        variance(values) {
            let mean = 0, count = 0;

            for (const v of values) {
                const n = Number(v);
                if (Number.isFinite(n)) {
                    mean += n;
                    count++;
                }
            }
            if (!count) return null;
            mean /= count;

            let sumSq = 0;
            for (const v of values) {
                const n = Number(v);
                if (Number.isFinite(n)) {
                    const d = n - mean;
                    sumSq += d * d;
                }
            }
            return sumSq / count;
        },

        stddev(values) {
            const v = TinyDataTable.aggregators.variance(values);
            return v == null ? null : Math.sqrt(v);
        },

        /* ---------- EXTREMES ---------- */

        first(values) {
            for (const v of values) {
                if (v != null) return v;
            }
            return null;
        },

        last(values) {
            for (let i = values.length - 1; i >= 0; i--) {
                const v = values[i];
                if (v != null) return v;
            }
            return null;
        }
    };


    TinyDataTable.registerAggregator = function (name, fn) {
        if (!name || typeof name !== 'string') throw new Error('Aggregator name must be a string');
        if (typeof fn !== 'function') throw new Error('Aggregator must be a function');
        TinyDataTable.aggregators[name] = fn;
    };

    TinyDataTable._normalizeOptions = (options) => {
        // Check if the options are already in the correct format (array of objects with value and label)
        if (Array.isArray(options) && options.length > 0 && options[0].hasOwnProperty('value') && options[0].hasOwnProperty('label')) {
            // If options is already an array of objects with value and label, return it as is
            return options;
        } else if (Array.isArray(options)) {
            // If options is an array of values, map it to an array of { value, label }
            return options.map(option => ({
                value: option,
                label: option
            }));
        } else if (typeof options === 'object' && options !== null) {
            // If options is an object, map its entries to { value, label }
            return Object.entries(options).map(([key, value]) => ({
                value: key,
                label: value
            }));
        } else {
            throw new Error('Invalid options format. Expected an array or object.');
        }
    };

    TinyDataTable.buildSelect = (options, defaultValue, onChange) => {
        // Normalize options to a consistent array of { value, label }
        const normalizedOptions = TinyDataTable._normalizeOptions(options);
        const select = _dtCreateElement('select', 'tt-select-default');
        // Loop through the normalized options and create option elements
        normalizedOptions.forEach(option => {
            const optionElement = _dtCreateElement('option', { value : String(option.value), text : String(option.label)});
            if (String(option.value) === String(defaultValue)) optionElement.selected = true;
            select.appendChild(optionElement);
        });
        // If no default value is provided, select the first option
        if (!defaultValue && select.options.length > 0) select.options[0].selected = true;
        if (onChange && typeof onChange === 'function') {
            select.addEventListener('change', onChange);
        }
        return select;
    }

    /*
    TinyDataTable.exportToExcel = function (table, sheetname, filename) {
        if (!window.XLSX) {
            throw new Error('Error: SheetJS library is not loaded. Please ensure that the SheetJS library is properly included in your project.');
        }

        sheetname = sheetname || 'Sheet1';

        if (!table) return;
        // filename is optional → derive from sheetname
        if (isBlank(filename)) {
            filename = sanitizeFilename(sheetname) + '.xlsx';
        } else if (!/\.xlsx$/i.test(filename)) {
            filename += '.xlsx';
        }

        const _api = table.api();

        // type -> { t, z } mapping (adjust to your internal col.type vocabulary)
        const TYPE_FORMAT = {
            int:   { t: 'n', z: '0' },
            integer:{ t: 'n', z: '0' },
            number:{ t: 'n', z: '0.00' },
            float: { t: 'n', z: '0.00' },
            decimal:{ t: 'n', z: '0.00' },
            percent:{ t: 'n', z: '0.00%' },
            date:  { t: 'd', z: 'yyyy-mm-dd' },
            datetime:{ t: 'd', z: 'yyyy-mm-dd hh:mm' },
            text:  { t: 's', z: '@' }
        };

        const normalizeType = (t) => (t == null ? '' : String(t).toLowerCase());

        // Convert raw string to number/date when possible
        const coerceValueByType = (value, type) => {
            if (value == null) return value;

            // If buildRowArray already returns strings, start from string
            const s = (typeof value === 'string') ? value.trim() : value;

            switch (normalizeType(type)) {
                case 'int':
                case 'integer': {
                    if (typeof s === 'number') return Math.trunc(s);
                    const n = parseInt(String(s).replace(/[^\d\-]/g, ''), 10);
                    return Number.isFinite(n) ? n : value;
                }
                case 'number':
                case 'float':
                case 'decimal': {
                    if (typeof s === 'number') return s;
                    // handle "1'234.56" or "1,234.56" / "1234,56"
                    const cleaned = String(s)
                        .replace(/[\s']/g, '')
                        .replace(/,(?=\d{3}\b)/g, '')   // drop thousand commas
                        .replace(/,/g, '.');           // comma decimal -> dot
                    const n = parseFloat(cleaned);
                    return Number.isFinite(n) ? n : value;
                }
                case 'percent': {
                    if (typeof s === 'number') return s; // assume already fraction or percent? pick one convention
                    const cleaned = String(s).replace('%', '').trim();
                    const n = parseFloat(cleaned.replace(/,/g, '.'));
                    // convention: "12.3%" -> 0.123 for Excel percent format
                    return Number.isFinite(n) ? (n / 100) : value;
                }
                case 'date':
                case 'datetime': {
                    if (s instanceof Date) return s;
                    const d = new Date(String(s));
                    return isNaN(d.getTime()) ? value : d;
                }
                default:
                    return value;
            }
        };

        _api.getFullData(true, true)
            .then(function ({ headers, rows }) {
                // Build header label row
                const headerLabels = headers.map(h => h?.label ?? '');

                // Coerce values to proper JS types so SheetJS writes correct cell types
                const typedRows = rows.map(r =>
                    r.map((cellValue, c) => coerceValueByType(cellValue, headers[c]?.type))
                );

                const formattedData = [headerLabels, ...typedRows];
                const ws = XLSX.utils.aoa_to_sheet(formattedData);

                // Bold header row
                for (let c = 0; c < headerLabels.length; c++) {
                    const addr = XLSX.utils.encode_cell({ r: 0, c });
                    if (ws[addr]) ws[addr].s = { font: { bold: true } };
                }

                // Apply number/date formats by column type (rows start at r=1)
                for (let c = 0; c < headers.length; c++) {
                    const fmt = TYPE_FORMAT[normalizeType(headers[c]?.type)];
                    if (!fmt) continue;

                    for (let r = 1; r < formattedData.length; r++) {
                        const addr = XLSX.utils.encode_cell({ r, c });
                        const cell = ws[addr];
                        if (!cell) continue;

                        // Assign type/format; keep existing t if SheetJS already set it correctly
                        if (fmt.t) cell.t = fmt.t;
                        if (fmt.z) cell.z = fmt.z;
                    }
                }

                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, sheetname);
                XLSX.writeFile(wb, filename);
            })
            .catch(function (error) {
                console.error('Error fetching data for export:', error);
            });
    };
    */

    TinyDataTable.registerExporter = function (format, exporter) {
        if (!format || typeof exporter?.export !== 'function') {
            throw new Error('Invalid exporter');
        }
        TinyDataTable.exporters = TinyDataTable.exporters || {};
        TinyDataTable.exporters[String(format).toLowerCase()] = exporter;
    };

    TinyDataTable._dtCreateElement = _dtCreateElement;
    // Also expose the semantic version on the constructor itself for
    // easier access when using TinyDataTable without modules.
    TinyDataTable.VERSION = TINYDATATABLE_VERSION;

    return TinyDataTable;
}));
