# TinyDataTable

TinyDataTable is a lightweight, dependency-free data table component written in plain JavaScript, with optional integration of [mark.js] for search term highlighting.

It is designed for:

- Very fast rendering (plain JS, no jQuery).
- Clear separation of concerns (data source vs. rendering vs. pagination).
- Simple but powerful features comparable to DataTables:
  - Local (client-side) data
  - Ajax (server-side) data
  - Sorting by column
  - Global search
  - Paging with a page-size selector
  - Child rows
  - Grouping with group headers and merged cells
  - Row selection (with or without grouping)
  - Footer aggregates (sums)
  - Built-in search input and filters bar (optional)
  - Smart layout wrapper: scroll wrapper around the table only, with an optional outer container when pager/search/filters are used
  - Search highlighting with mark.js
  - Event system

This README goes into detail with multiple examples so you can *really* understand how to use every feature.

---

## 1. Installation

### 1.1 Files

Include the JS and CSS files:

```html
<link rel="stylesheet" href="TinyDataTable.css" />
<script src="TinyDataTable.js"></script>
```

If you want search highlighting, include mark.js and then TinyDataTable:

```html
<script src="https://cdn.jsdelivr.net/npm/mark.js@8.11.1/dist/mark.min.js"></script>
<script src="TinyDataTable.js"></script>
```

TinyDataTable will auto-detect `window.Mark` or `globalThis.Mark`.  
If you load mark.js later (dynamic import), you can set it manually:

```js
TinyDataTable.setMarkConstructor(Mark);
```

### 1.2 UMD

The library is wrapped in a UMD wrapper:

- As a global: `window.TinyDataTable`.
- As CommonJS: `require('TinyDataTable')`.
- As AMD: `define(['TinyDataTable'], ...)`.

---

## 2. Minimal example

```html
<table id="users"></table>

<script>
  var users = [
    { id: 1, name: 'Alice', email: 'alice@example.com', role: 'Admin' },
    { id: 2, name: 'Bob',   email: 'bob@example.com',   role: 'Editor' }
  ];

  var table = new TinyDataTable('#users', {
    columns: [
      { key: 'id',    title: 'ID',    sortable: true },
      { key: 'name',  title: 'Name',  sortable: true },
      { key: 'email', title: 'Email', sortable: true },
      { key: 'role',  title: 'Role',  sortable: true }
    ],
    data: users,
    paging: {
      enabled: true,
      pageSize: 10
    }
  });
</script>
```

- Columns are defined via `columns`.
- Data is an array of plain objects, passed via `data`.
- Paging is enabled with a default page size of 10.

---

## 3. Configuration reference (with examples)

### 3.1 `columns`

Each column definition is an object:

- `key` (string, required): property of the row object.
- `title` (string): header text (default: `key`).
- `className` (string): CSS class for all cells for that column.
- `sortable` (bool, default `true`).
- `searchable` (bool, default `true`).
- `visible` (bool, default `true`).
- `type` (string, optional): logical type name that binds a default renderer from `TinyDataTable.typeRenderers`.
- `render(...)` (function): custom renderer (overrides `type` if provided).

Renderer API (new + legacy):

- **Preferred (v1.2+)**: `render({ value, row, index, ctx })`
- **Legacy (still supported)**: `render(value, row, index, ctx)`

`ctx` includes:

- `ctx.phase`: `'value' | 'display' | 'search' | 'footer'` (TinyDataTable calls your renderer in different phases)
- `ctx.column`: the column definition
- `ctx.rowKey`, `ctx.rowIndex`, `ctx.isChild`
- helpers:
  - `ctx._esc(str)` → HTML-escape
  - `ctx._html(str)` → mark a string as HTML (returns `{ html: "..." }`)
  - `ctx._blank(v)` → whether value is null/empty

Example:

```js
var columns = [
  { key: 'id',     title: 'ID',     sortable: true },
  { key: 'name',   title: 'Name',   sortable: true },
  { key: 'email',  title: 'Email',  sortable: true },
  { key: 'role',   title: 'Role',   sortable: true },
  {
    key: 'amount',
    title: 'Amount (CHF)',
    sortable: true,
    className: 'text-right',
    render: function ({ value, row, index, ctx }) {
      // ctx.isChild: true for child rows
      // ctx.rowKey: unique row key
      if (value == null) return '';
      return Number(value).toLocaleString(this.locale || 'de-CH', { minimumFractionDigits: 2 });
    }
  }
];
```

#### Column `type` and built-in type renderers

TinyDataTable ships with a small registry of reusable renderers:

```js
TinyDataTable.typeRenderers = {
  digits({ value, ctx }) { /* ... */ },
  ngdigits({ value, ctx }) { /* ... */ }
};
```

If you specify `col.type` and no explicit `col.render`, TinyDataTable will look up
`TinyDataTable.typeRenderers[col.type.toLowerCase()]` and use it as the renderer. The
renderer is called with `this` bound to the TinyDataTable instance, so it can access `this.locale`.

Built-in types:

- `type: 'digits'`
  - Interprets the the cell value as a number.
  - Formats it using `Number(value).toLocaleString(this.locale || 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
  - Falls back to `num.toFixed(2)` if locale formatting fails.

- `type: 'ngdigits'`
  - Same as `digits`, but negates the value before formatting.
  - Useful for cases where “negative is good” (e.g. cost savings, deltas).

Example:

```js
var columns = [
  { key: 'id',      title: 'ID' },
  { key: 'account', title: 'Account' },
  {
    key: 'amount',
    title: 'Amount',
    type: 'digits',          // uses TinyDataTable.typeRenderers.digits
    className: 'text-right'
  },
  {
    key: 'delta',
    title: 'Δ',
    type: 'ngdigits',        // formats negative of the given value
    className: 'text-right'
  }
];
```

You can also register your own global type renderers:

```js
TinyDataTable.appendTypeRenderers({
  percent: function ({ value, ctx }) {
    if (ctx._blank(value)) return '';
    var num = Number(value);
    if (Number.isNaN(num)) return value;
    if (ctx.phase === 'display') return num.toFixed(1) + ' %';
    return num;
  }
});

// later
{ key: 'completion', title: 'Completion', type: 'percent' }
```
### 3.2 Data: local vs Ajax vs hybrid "load once"

TinyDataTable supports three main strategies:

1. Local data (`data` array) – everything happens in memory.
2. Ajax / server-side data (`ajax.fetch` or `ajax.url`) – server returns each page.
3. Hybrid "load once" (`ajax.loadOnce`) – first load via Ajax, then client-side filtering/sorting/paging.

#### Local data

```js
var table = new TinyDataTable('#table', {
  columns: columns,
  data: myArrayOfRows,  // array of plain objects
  paging: { enabled: true, pageSize: 25 }
});
```

All operations (search, sort, paging) are done in memory.

#### Ajax data with custom `fetch` function

You implement the "server" as a function:

```js
var table = new TinyDataTable('#table', {
  columns: columns,
  ajax: {
    fetch: function ({ state, columns }) {
      // state = the current table state
      //   { page, pageSize, pagingEnabled, searchText, sortOrders, totalRows, filters }
      // columns = current column definitions (after DOM merge + normalization)

      return fetch('/api/users?' + new URLSearchParams({
        page: state.page,
        pageSize: state.pageSize,
        search: state.searchText || '',
        // primary sort only (UI is single-column, but defaultSort/programmatic can be multi-column)
        sortKey: (state.sortOrders && state.sortOrders[0]) ? state.sortOrders[0].key : '',
        sortDir: (state.sortOrders && state.sortOrders[0]) ? state.sortOrders[0].dir : '',
        // optional: pass filters
        filters: JSON.stringify(state.filters || {})
      }))
        .then(function (res) { return res.json(); })
        .then(function (json) {
          return {
            rows: json.items,  // array of row objects
            total: json.total  // total number of rows on the server
          };
        });
    }
  },
  paging: {
    enabled: true,
    pageSize: 25,
    serverSide: true
  }
});
```

Here you have full control of the request and response shape.

#### Ajax data using `ajax.url` + `buildParams` + `transform`

If you prefer a more declarative configuration, you can let TinyDataTable perform the fetch via its internal helper:

```js
var table = new TinyDataTable('#table', {
  columns: columns,
  ajax: {
    url: '/api/users',          // string or function ({state, columns}) => URL
    method: 'GET',              // default 'GET'
    headers: { 'X-Auth': '...' },

    // optional: tweak query/body params
    // buildParams receives a single "ajaxParams" object (see below) and must return
    // either an object (to be encoded) or a URLSearchParams instance or a pre-encoded string.
    buildParams: function (ajaxParams) {
      // ajaxParams = {
      //   tinyDataTable: true,
      //   paging: { page, length, start, pagingEnabled },
      //   searchText,
      //   columns: [{ key, searchable, orderable }...],
      //   order: [{ key, dir }...],
      //   filters: { ... }
      // }
      return ajaxParams;
    },

    // optional: transform raw JSON into { rows, total }
    transform: function (json) {
      return {
        rows: json.items,
        total: json.total
      };
    }
  },
  paging: {
    enabled: true,
    pageSize: 25,
    serverSide: true
  }
});
```

Behavior:

- For `GET`:
  - `buildParams(ajaxParams)` → return value is encoded into the query string.
- For non-GET:
  - `buildParams(ajaxParams)` → return value is sent as JSON body (`Content-Type: application/json` by default).
- Response handling:
  - If `transform` is provided: `transform(json)` must return `{ rows, total }`.
  - Else:
    - If `json` is an array: `rows = json`, `total = rows.length`.
    - If `json` is an object: `rows = json.data || []`, `total = json.total ?? rows.length`.

#### Hybrid Ajax: `loadOnce` (AjaxLoadOnceDataSource)

Sometimes you want to load data from the server only once, then do all filtering/sorting/paging on the client. Use `ajax.loadOnce: true`:

```js
var table = new TinyDataTable('#table', {
  columns: columns,
  ajax: {
    url: '/api/orders',
    loadOnce: true,            // important
    method: 'GET',
    transform: function (json) {
      // In loadOnce mode, only `rows` is required;
      // TinyDataTable will compute total itself.
      return json.items;
    }
  },
  paging: {
    enabled: true,
    pageSize: 25,
    serverSide: false          // behavior is local after first load
  }
});
```

How it works internally:

- On the first `draw()`:
  - Data is fetched via Ajax (`ajax.fetch` if provided, else `ajax.url`).
  - Resulting rows are stored into a `LocalDataSource`.
- On subsequent draws:
  - Only the local source is used (search, sort, paging all in memory).
  - Ajax is not called again unless you call `dataSource.refresh()` from custom code.

#### Using HTML data attributes for URLs

You can configure the URL directly in the HTML:

```html
<table id="orders" data-url="/api/orders"></table>
<table id="orders-cache" data-loadonce-url="/api/orders"></table>
```

Then:

```js
// Classic Ajax (server-side every time):
var table1 = new TinyDataTable('#orders', {
  columns: columns,
  paging: { enabled: true, pageSize: 25, serverSide: true }
});

// Load-once hybrid:
var table2 = new TinyDataTable('#orders-cache', {
  columns: columns,
  paging: { enabled: true, pageSize: 25 }
  // ajax.loadOnce is automatically true when data-loadonce-url is present
});
```

Precedence for the actual URL:

1. `data-loadonce-url` (if present) – used with `loadOnce`.
2. `data-url` (if present).
3. `options.ajax.url` (if provided).
### 3.3 `paging`

```js
paging: {
  enabled: true,
  pageSize: 25,
  pageSizeOptions: [10, 25, 50, 100],
  serverSide: false // informational, used mostly for your own logic
}
```

- `enabled`: whether paging UI and logic is active.
- `pageSize`: initial page size.
- `pageSizeOptions`: values in the length dropdown.
- `serverSide`: hint for your code (TinyDataTable does not change behavior based on this flag; what matters is whether `ajax` is set).

### 3.4 `childRows`

Child rows allow you to attach a list of "sub-rows" to each parent row. They are rendered inline in the same `<tbody>` as additional rows beneath the parent.

```js
childRows: {
  enabled: true,
  dataKey: 'children',            // property on parent
  startExpanded: false,           // if true: all are expanded initially
  rowId: function (row) { return row.id; }, // used to compute rowKey
  toggleOnRowClick: true,         // row click toggles children
  showToggleIcon: true,           // show arrow icon
  columns: [ ... ]                // columns for all child rows (optional)
}
```

Or per-parent layout:

```js
childRows: {
  enabled: true,
  dataKey: 'children',
  getColumns: function (parentRow) {
    if (parentRow.status === 'Completed') {
      return completedChildColumns;
    }
    return defaultChildColumns;
  }
}
```

#### Lazy-loading children in Ajax mode

If you have many children per parent, you can load them only when needed:

```js
var table = new TinyDataTable('#projects', {
  columns: projectColumns,
  ajax: {
    url: '/api/projects',
    method: 'GET'
  },
  childRows: {
    enabled: true,
    dataKey: 'children',
    lazyLoad: true,                    // load children on demand
    rowId: function (row) {            // how to identify the parent on the server
      return row.id;
    },
    columns: childColumns
  }
});
```

When `lazyLoad: true` and a parent is expanded:

- If `row[dataKey]` is empty or missing, TinyDataTable will call a request to the same `ajax.url` with parameters similar to:

  - `child=true` and `rowId=<parentId>`

- The endpoint must return an array of child rows.
- That array is stored into `row[dataKey]` (default `"children"`), and child rows are rendered normally.
- Subsequent expansions use the cached children, unless you manually clear or replace `row[dataKey]`.

This lazy-loading path only runs when:

- `childRows.lazyLoad === true`
- `ajax.url` is configured
- The table is in Ajax mode (not purely local only).

Child rows:

- Are not part of sorting logic; only parents are sorted.
- Are expanded/collapsed by:
  - Clicking the arrow icon.
  - Clicking the parent row (if `toggleOnRowClick: true`).
  - Or via API: `expandChildRows(rowKey)`, `collapseChildRows(rowKey)`, `toggleChildRows(rowKey)`, `collapseAllChildRows()`.

### 3.5 `grouping`

Grouping is independent of child rows. It groups **parent rows** by one or more fields.

```js
grouping: {
  enabled: true,
  keys: ['orderId', 'paymentType'],  // group key
  mergeColumns: ['total'],           // merged cells using rowspan
  header: {
    show: true,
    render: function (info) {
      // info.keys   -> ['orderId', 'paymentType']
      // info.values -> { orderId: 'A-1001', paymentType: 'Card' }
      // info.rows   -> array of rows in this group (on this page)
      // info.groupIndex -> index of the group on the page
      var first = info.rows[0] || {};
      return 'Order ' + info.values.orderId +
             ' (' + info.values.paymentType + ') - ' +
             (first.customer || '') +
             ' - ' + (first.date || '');
    }
  }
}
```

Behavior:

- All rows with the same values for `keys` form a group.
- Groups are contiguous blocks in the current page.
- A group header row can be shown before its rows.
- For each column in `mergeColumns`, cells are merged with `rowspan` across the group:
  - The first row of the group renders the cell with `rowSpan = groupSize`.
  - The remaining rows skip that cell.

When paging is enabled, grouping is applied per page. It is possible for a logical group (e.g. all rows with `orderId = A-1001`) to be split across pages; each page will render group headers and merged cells only for the subset of rows on that page.

### 3.6 `select` (row selection)

Enables row selection via a checkbox column.

#### Basic

```js
select: true
```

This is equivalent to:

```js
select: {
  enabled: true,
  groupMode: 'row'
}
```

#### Advanced

```js
select: {
  enabled: true,
  groupMode: 'row'   // or 'group'
}
```

- When `select.enabled` is true:
  - A header cell with a checkbox is added before the first data column.
  - Every parent row gets a checkbox cell before its data columns.
  - Every child row gets an **empty** cell before its data columns to keep alignment with parents.
- Child rows are not directly selectable; they are visually aligned with the selection column.

##### Group-level selection

When grouping is enabled and `select.groupMode === 'group'`:

- Only the **first** row of each group gets a checkbox.
- That checkbox cell is merged with `rowspan = groupSize`.
- Clicking it selects/unselects all parent rows in that group.
- Child rows still get an empty selection cell.

Header checkbox behavior:

- When toggled:
  - In any mode, it selects or unselects all **parent rows on the current page**.
- The header checkbox shows:
  - Checked: all parent rows on the page are selected.
  - Unchecked: none selected.
  - Indeterminate: some but not all selected.

##### Selection API

```js
var keys = table.getSelectedRowKeys(); // ['1', '5', 'A-1001', ...]
var rows = table.getSelectedRows();    // underlying row objects

table.selectRow('123');        // programmatically select a row
table.unselectRow('123');      // unselect a row

table.selectAllOnPage();       // select all parent rows on current page
table.unselectAllOnPage();     // unselect all parent rows on current page

table.clearSelection();        // clear all selection
```

Selection persists across pagination (keys remain selected even if you leave the page).

##### Selection events

You can listen to selection changes:

```js
table.on('select', function (info) {
  // Inside handler, `this` is the TinyDataTable instance
  console.log('Selection changed:', info);
});
```

`info`:

```js
{
  mode: 'row'    // clicked a row checkbox (non-group mode)
     | 'group'   // clicked a group-level checkbox (group mode)
     | 'page'    // clicked the header "select all" checkbox
     | 'clear',  // called clearSelection()

  rowKey: '...',           // key of the clicked row (or null for page/clear)
  checked: true/false,     // new checkbox state
  affectedRowKeys: [...],  // all row keys affected by this action
  selectedRowKeys: [...]   // full list of selected keys after the change
}
```

Example: log selected rows after every change:

```js
table.on('select', function (info) {
  console.log('Now selected:', this.getSelectedRowKeys());
});
```

### 3.7 `footer` (aggregates)

```js
footer: {
  enabled: true,
  sumColumns: ['amount', 'hours']
}
```

- A `<tfoot>` is added with one `<th>` per column.
- For each key in `sumColumns`:
  - The footer cell shows the sum of all rows (after search/sort).
  - In local mode: sum across all filtered rows (regardless of paging).
  - In Ajax mode: sum across rows of the current page (TinyDataTable has no knowledge of all data).

The first footer cell (selection column) is reserved and left empty.

### 3.8 `highlight` (mark.js)

```js
highlight: {
  enabled: true,
  contextSelector: 'tbody', // optional, defaults to tbody
  markOptions: {
    className: 'tt-highlight',
    separateWordSearch: true,
    accuracy: 'partially'
    // any valid mark.js options
  }
}
```

When global `search(text)` is used and mark.js is available:

- TinyDataTable calls `unmark()` then `mark(searchText, markOptions)` on the given context.
- Context:
  - If `contextSelector` is provided: `table.querySelector(contextSelector)`.
  - Else: `tbody` (or `table` as a fallback).

If mark.js is not available, it silently does nothing.

### 3.9 `defaultSort`

TinyDataTable stores sorting as a **list**: `state.sortOrders = [{ key, dir }, ...]`.

You can provide an initial sort via either:

1) Object map (recommended):

```js
defaultSort: {
  name: 'asc',
  createdAt: 'desc' // secondary sort (optional)
}
```

2) Array of sort specs:

```js
defaultSort: [
  { key: 'name', dir: 'asc' },
  { key: 'createdAt', dir: 'desc' }
]
```

Notes:

- The header-click UI uses **single-column** sorting (it cycles: none → asc → desc → none) and rewrites `sortOrders` accordingly.
- For compatibility with some table wrappers, TinyDataTable also checks `options.order` if `defaultSort` is not provided.

---


### 3.10 `scrollX` / `scrollY`

These options control whether the table is wrapped in a scrollable container.

```js
scrollX: 'auto', // default
scrollY: false   // default
```

Behavior:

- If `scrollX !== false` or `scrollY !== false`, TinyDataTable wraps the table in a `<div>` with class `.tiny-table-wrapper`.
- That wrapper gets `overflow-x` and `overflow-y` set based on the values:

  - `'auto'`  → `overflow: auto`
  - `true` or any other truthy (non-'auto') → `overflow: scroll`
  - `false`   → `overflow: visible`

Default is:

```js
scrollX: 'auto', // horizontal scroll only if needed
scrollY: false   // no vertical scroll by default
```

You can constrain the wrapper size via CSS to force scrolling:

```css
/* Example: fixed height with vertical scroll */
#orders-container .tiny-table-wrapper {
  max-height: 300px;
}
```

And initialise:

```html
<div id="orders-container">
  <table id="orders"></table>
</div>

<script>
  var table = new TinyDataTable('#orders', {
    columns: [...],
    data: orders,
    scrollX: 'auto',
    scrollY: 'auto', // vertical scroll auto inside container
    paging: { enabled: false }
  });
</script>
```

The pager (if enabled) is always placed **outside** the scroll wrapper.


### 3.11 `emptyMessage` and `locale`

#### `emptyMessage`

When there are no rows to display (either because the initial data set is empty or because filtering removed everything), TinyDataTable renders a single row with a single cell that spans all visible columns.

- The cell has class `.tiny-table-empty-cell`.
- The text comes from `emptyMessage` (option) or the `data-inplace-empty-message` attribute.

Examples:

```html
<table id="users" data-inplace-empty-message="No users found."></table>
```

```js
var table = new TinyDataTable('#users', {
  columns: [
    { key: 'id',   title: 'ID' },
    { key: 'name', title: 'Name' }
  ],
  data: [],                         // empty
  emptyMessage: 'No users have been created yet.',
  paging: { enabled: false }
});
```

If nothing is provided, the default message is `"No data available"`.

#### `locale`

The table instance stores a `locale` that is used by built-in renderers such as `TinyDataTable.typeRenderers.digits`:

```js
var table = new TinyDataTable('#orders', {
  locale: 'de-CH',       // default is navigator.language or 'en-US'
  columns: [
    { key: 'id',     title: 'ID' },
    { key: 'amount', title: 'Amount', type: 'digits', className: 'text-right' }
  ],
  data: orders
});
```

If you do not specify `locale`, TinyDataTable uses:

- `options.locale` if provided
- else `navigator.language` / `navigator.userLanguage`
- else `'en-US'`

You can also read it inside custom renderers via `this.locale`.

### 3.12 `customClass` and `createdRow` (row-level styling hooks)

For fine-grained styling, TinyDataTable offers two mechanisms:

1. `customClass` – pure CSS class assignment per row/child/group header.
2. `createdRow(tr, data, index)` – a hook that lets you manipulate the `<tr>` element.

#### `customClass`

`customClass` is an object with up to three keys:

- `row`
- `childRow`
- `groupRow`

Each key can be:

- A string (`'class-a class-b'`)
- An array of strings (`['class-a', 'class-b']`)
- A function `(data, meta) => string | string[]`

Where:

- For `row`: `data` is the row object, `meta` contains flags like:
  - `isChild`, `hasChildren`, `isExpanded`, `groupSize`, `rowIndexInGroup`.
- For `childRow`: `data` is the child row object, `meta.isChild === true`.
- For `groupRow`: used for group header rows. `data` is the group object:
  - `{ key, values: { groupKey: value }, rows: [...] }`
  - `meta` includes `isGroupHeader`, `groupIndex`, `groupKey`.

Example:

```js
var table = new TinyDataTable('#tasks', {
  columns: [
    { key: 'id',       title: 'ID' },
    { key: 'task',     title: 'Task' },
    { key: 'owner',    title: 'Owner' },
    { key: 'status',   title: 'Status' },
    { key: 'priority', title: 'Priority' }
  ],
  data: tasks,
  customClass: {
    row: function (row, meta) {
      var classes = [];
      if (row.status === 'Overdue') classes.push('row-overdue');
      if (row.priority === 'high') classes.push('row-high-priority');
      return classes;
    },
    groupRow: function (group, meta) {
      return 'group-header-row-' + meta.groupIndex;
    }
  }
});
```

TinyDataTable normalises a string into an array by splitting on whitespace.

#### `createdRow(tr, data, index)`

This hook is called after a row `<tr>` has been fully created and populated:

```js
var table = new TinyDataTable('#tasks', {
  columns: columns,
  data: tasks,
  createdRow: function (tr, row, index) {
    // `this` is the TinyDataTable API instance
    tr.title = 'Task #' + row.id + ' – ' + row.status;
  }
});
```

The signature is similar to DataTables’ `createdRow`.



### 3.13 Built-in search input and filters bar

TinyDataTable can render its own search input and filters bar above the table. When at least one of
paging, search or filters is enabled, the table, controls and pager are wrapped into a
`.tiny-table-container` structure:

```html
<div class="tiny-table-container">
  <div class="tiny-table-controls">
    <!-- filters bar + search input (if enabled) -->
  </div>
  <div class="tiny-table-wrapper">
    <table class="tiny-table">...</table>
  </div>
  <div class="tiny-table-pager">...</div>
</div>
```

If `scrollX`/`scrollY` are disabled, the wrapper is omitted and the table is placed directly
inside the container.

#### `search` option

```js
search: {
  enabled: true,                // if true, TinyDataTable renders a search input
  placeholder: 'Search...'      // placeholder text for the input
}
```

When `search.enabled` is `true`, a search box is rendered inside `.tiny-table-controls`. Typing
in this box is equivalent to calling `table.search(text)`.

You can still call `table.search(text)` manually or wire your own external input; the built-in
input is purely optional.

#### `filters` option

```js
filters: {
  enabled: true,
  items: [
    {
      key: 'status',
      type: 'select',           // or omit / any non-'boolean' → <select>
      label: 'Status',
      defaultValue: '',
      options: [
        { value: '',        label: 'All statuses' },
        { value: 'Active',  label: 'Active' },
        { value: 'Invited', label: 'Invited' }
      ]
    },
    {
      key: 'hasChildren',
      type: 'boolean',         // renders a checkbox
      label: 'Only rows with children',
      defaultValue: false,
      predicate: function (row, value, ctx) {
        // value is the checkbox state (true/false)
        if (!value) return true; // unchecked → no filter
        return Array.isArray(row.children) && row.children.length > 0;
      }
    }
  ]
}
```

- `enabled`: master flag for the filters bar.
- `items`: array of filter definitions.

Each filter definition:

- `key` (string, required): row property used by this filter (e.g. `'status'`).
- `type` (string):
  - `'boolean'` → renders a checkbox.
  - any other value or omitted → renders a `<select>`.
- `label` (string, optional): label text next to the input.
- `defaultValue` (any, optional): initial filter value.
- `options` (array, for non-boolean filters):
  - `[{ value: 'Active', label: 'Active users' }, ...]`
- `predicate(row, value, ctx)` (function, optional):
  - Custom filter logic. If provided, TinyDataTable uses it instead of the default comparison.
  - `row` is the current row object.
  - `value` is the current filter value (e.g. `true` for a checked checkbox, or a string from `<select>`).
  - `ctx` contains `{ filter, table }`.

Filter values are stored in `state.filters` and are applied in the local data source (`LocalDataSource`)
and passed to the server in Ajax mode via `params.filters`.

Example with local data:

```js
var table = new TinyDataTable('#users', {
  columns: columns,
  data: users,
  paging: { enabled: true, pageSize: 10 },
  search: { enabled: true, placeholder: 'Search users...' },
  filters: {
    enabled: true,
    items: [
      {
        key: 'status',
        type: 'select',
        label: 'Status',
        defaultValue: '',
        options: [
          { value: '',        label: 'All statuses' },
          { value: 'Active',  label: 'Active' },
          { value: 'Invited', label: 'Invited' },
          { value: 'Suspended', label: 'Suspended' }
        ]
      },
      {
        key: 'highAmount',
        type: 'boolean',
        label: 'Amount ≥ 500',
        defaultValue: false,
        predicate: function (row, checked) {
          if (!checked) return true;
          return Number(row.amount || 0) >= 500;
        }
      }
    ]
  }
});
```

Example with Ajax:

```js
var table = new TinyDataTable('#ajax-users', {
  columns: columns,
  ajax: {
    url: '/api/users',
    method: 'GET',
    transform: function (json) {
      return { rows: json.items, total: json.total };
    }
  },
  paging: { enabled: true, pageSize: 25, serverSide: true },
  search: { enabled: true },
  filters: {
    enabled: true,
    items: [
      {
        key: 'role',
        type: 'select',
        label: 'Role',
        defaultValue: '',
        options: [
          { value: '',      label: 'All roles' },
          { value: 'Admin', label: 'Admin' },
          { value: 'User',  label: 'User' }
        ]
      }
    ]
  }
});
```

On each Ajax request, the current `state.filters` object is passed as `params.filters` so you can
apply it on the server side.

### 3.14 Tooltips, row actions, and export

#### Tooltips

TinyDataTable can attach tooltips to header cells, filter controls, and data cells.
Any element with a `data-tooltip` attribute is picked up after render.

Internally, TinyDataTable calls `_initTooltipsInScope(root)` after rendering:

- At initialization: it initializes tooltips within the table container (controls + table wrapper) so toolbar buttons, filters and header tooltips work immediately.
- After each draw: it initializes tooltips for newly rendered elements (typically in `<tbody>`).

`root` is the DOM node used as the **delegation scope** when the tooltip adapter supports delegation (recommended).  
If your adapter does not support delegation, TinyDataTable falls back to binding tooltips per element under the current table body.

You typically do **not** need to call `_initTooltipsInScope()` yourself unless you inject custom DOM nodes with `data-tooltip` after the table has rendered.

Per-column options:

- `headerTooltip` (string): shown when hovering the column header.
- `tooltip` (string or function): tooltip for each data cell in that column.
  - If function: `tooltip(row, rawValue, meta)` where `meta = { rowKey, rowIndex, isChild }`.

Tooltip adapter:

- If `window.tippy` exists, TinyDataTable will use it automatically.
- Or register your own adapter globally:

```js
TinyDataTable.setTooltipAdapter(function (el, content) {
  // plug in your tooltip library here
  // e.g. myTooltipLib.bind(el, { content, allowHTML: true })
});
```

#### Row actions

If your renderer outputs links like:

```html
<a href="#" data-action="edit-user" data-id="123">Edit</a>
```

TinyDataTable emits:

- `action` (always)
- `action:editUser` (namespaced, camelCased)

Payload includes `{ action, dataset, rowKey, id, rowData, rowEl, event }`.


#### Toolbar buttons (`options.buttons`)

TinyDataTable can render a small **toolbar/actions area** next to the built-in controls (search + filters).
This is useful for common actions such as refresh, export, opening a settings modal, etc.

Provide an array of button definitions:

```js
var table = new TinyDataTable('#customers', {
  columns: columns,
  ajax: { url: '/api/customers', method: 'GET' },
  paging: { enabled: true, pageSize: 25, serverSide: true },

  // New: control buttons rendered by TinyDataTable
  buttons: [
    { icon: '<i class="material-icons">refresh</i>', onClick: (api) => api.refresh(), tooltip: 'Refresh' },

    // Built-in export button (requires SheetJS / XLSX)
    { type: 'export', icon: '<i class="material-icons">file_download</i>', sheetname: 'Liste des clients', filename: 'customers.xlsx', tooltip: 'Export' },

    // Custom HTML chunk (not a button)
    { html: '<span class="badge">Custom HTML</span>' },

    // Regular button with icon + title (text)
    { icon: '<i class="material-icons">settings</i>', title: 'Settings', onClick: (api) => openSettings(api), tooltip: 'Settings' },

    // Divider
    { divider: true },

    // Disabled item
    { text: 'Disabled', disabled: true }
  ]
});
```

Button definition fields:

- `type` (string, optional)
  - If `type: 'export'`, TinyDataTable will call `TinyDataTable.exportToExcel(api, sheetname, filename)` when clicked.
- `icon` (string, optional): HTML string for an icon (e.g. Material Icons).  
  If `icon` is provided **without** `text`/`html`, TinyDataTable renders an **icon-only** button and applies the `tt-btn-icon` class.
- `text` (string, optional): plain text label (escaped).
- `html` (string, optional):
  - If the object contains **only** `html`, it is inserted as a raw HTML wrapper (`<span class="tt-btn-html">...`).
  - If used alongside `icon`, it becomes the button label HTML.
- `title` (string, optional): native `title` attribute (also shown as tooltip by the browser).
- `tooltip` (string, optional): sets `data-tooltip` to integrate with TinyDataTable tooltips (Tippy.js / custom adapter).
- `className` (string|string[], optional): additional classes added to the `<button>`.
- `disabled` (boolean | (api) => boolean): disables the button.
- `onClick(api, event, def)` (function): click handler.
- `divider: true`: renders a visual divider between actions.
- `Node` items: you can insert a raw DOM node directly into the toolbar.

CSS hooks used by the built-in renderer:

- `.tiny-table-controls-actions`: container for the actions
- `.tt-btn`: regular button
- `.tt-btn-icon`: icon-only button
- `.tt-btn-divider`: divider
- `.tt-btn-html`: wrapper around HTML-only items



#### Export (XLSX)

If you include SheetJS (XLSX) on the page, you can export the currently loaded data:

```js
TinyDataTable.exportToExcel(table, 'Sheet1', 'export.xlsx');
```

Underlying helpers:

- `table.headers(visibleOnly = true)`
- `table.getFullData(visibleOnly = true)` (returns a Promise)


## 4. Events

Register with:

```js
table.on('eventName', function (payload, api) {
  // `this` === api === TinyDataTable instance
});
```


### 4.1 Event summary (quick reference)

| Event        | When it fires                                                                 | Payload shape                                                                                           |
|-------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `draw`       | After each draw (data loaded & rendered)                                    | a shallow clone of the current `state` (e.g. `{ page, pageSize, totalRows, searchText, sortOrders, filters... }`) |
| `page`       | When current page changes                                                   | `{ page, oldPage }`                                                                                              |
| `search`     | When `search(text)` is called                                               | `{ searchText }`                                                                                                 |
| `order`      | When sorting changes                                                        | `{ sortOrders, previousSortOrders, changed }`                                                                      |
| `length`     | When page size (page length) changes                                        | `{ pageSize, oldPageSize }`                                                                                      |
| `xhr`        | After an Ajax load completes (Ajax mode only)                               | `{ rows, total, state }`                                                                                          |
| `childShown` | When child rows of a given parent are expanded                              | `{ rowKey }`                                                                                                     |
| `childHidden`| When child rows are collapsed (single parent or all via `collapseAll...()`) | `{ rowKey }` or `{ rowKey: null, all: true }`                                                                    |
| `select`     | When selection changes (row, group, page, clear)                            | `{ mode, rowKey, checked, affectedRowKeys, selectedRowKeys }`                                                    |
| `action`     | When a row action link `<a data-action="...">` is clicked                 | `{ action, dataset, rowKey, id, rowData, rowEl, event }`                                                         |
| `action:xyz` | Same as `action`, but namespaced per action (camelCased)                    | same as `action`                                                                                                 |

Notes:

- The source contains an `init` event hook, but it is currently not emitted in this build.
- `draw` payload is the full state clone (useful if you need `searchText`, `sortOrders`, `filters`, ...).
- `order.changed` is `{ key, dir }` where `dir` can be `null` when a sort is removed.

Example: logging draw events and accessing DOM:

```js
table.on('draw', function (info) {
  var dom = this.getDom();
  console.log('draw:', info, dom.tbody);
});
```

---

## 5. Public API overview

### 5.1 Core

- `draw()`: re-renders table based on current state.
- `search(text)`: sets global filter text, resets to page 1, and redraws.
- `sortBy(key)`: toggles sorting on the given column: `none -> asc -> desc -> none`.
- `goToPage(pageNumber)`: changes page (if paging is enabled).
- `setData(data)`: replaces the local data (only in local mode).

### 5.2 Child rows

- `expandChildRows(rowKey)`
- `collapseChildRows(rowKey)`
- `toggleChildRows(rowKey)`
- `collapseAllChildRows()`

`rowKey` is derived from:

1. `childRows.rowId(row)` if provided.
2. `row.id` if present.
3. internal `__dt_index`.

### 5.3 Selection

- `getSelectedRowKeys()`
- `getSelectedRows()`
- `selectRow(rowKey)`
- `unselectRow(rowKey)`
- `selectAllOnPage()`
- `unselectAllOnPage()`
- `clearSelection()`

### 5.4 DOM helpers

- `getTableElement()`
- `getHeaderElement()`
- `getBodyElement()`
- `getFooterElement()`
- `getPagerElement()`
- `getDom()` → `{ table, thead, tbody, tfoot, pager }`

### 5.5 Misc

- `api()` → returns the TinyDataTable instance (mainly for symmetry with DataTables style).
- `TinyDataTable.setMarkConstructor(ctor)` → override mark.js constructor.

---


### 5.5 Public API summary table

| Method                    | Signature / usage                           | Description                                                                                         |
|---------------------------|---------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `api()`                   | `var api = table.api();`                    | Returns the TinyDataTable instance (DataTables-style).                                              |
| `on(event, handler)`      | `table.on('draw', fn)`                      | Register an event listener.                                                                         |
| `off(event, handler)`     | `table.off('draw', fn)`                     | Remove an event listener.                                                                           |
| `draw()`                  | `table.draw()`                              | Reload data from the DataSource and re-render the table.                                            |
| `search(text)`            | `table.search('alice')`                     | Apply a global search term (parents + children), reset to page 1, and redraw.                      |
| `sortBy(key)`             | `table.sortBy('name')`                      | Toggle sort for a given column key (`none → asc → desc → none`).                                   |
| `goToPage(page)`          | `table.goToPage(2)`                         | Change current page and redraw (no-op if paging disabled).                                          |
| `setData(data)`           | `table.setData(rows)`                       | Replace local data (only in local mode) and redraw.                                                 |
| `expandChildRows(key)`    | `table.expandChildRows('row-1')`            | Expand the child rows of the given parent row.                                                      |
| `collapseChildRows(key)`  | `table.collapseChildRows('row-1')`          | Collapse the child rows of the given parent row.                                                    |
| `toggleChildRows(key)`    | `table.toggleChildRows('row-1')`            | Toggle expansion of the given parent row’s children.                                                |
| `collapseAllChildRows()`  | `table.collapseAllChildRows()`              | Collapse all expanded child rows.                                                                   |
| `getSelectedRowKeys()`    | `table.getSelectedRowKeys()`                | Return an array of selected row keys (across pages).                                                |
| `getSelectedRows()`       | `table.getSelectedRows()`                   | Return underlying row objects for selected keys (only those currently known in local cache).        |
| `selectRow(key)`          | `table.selectRow('row-1')`                  | Programmatically select a row (and its group if `groupMode: 'group'`).                             |
| `unselectRow(key)`        | `table.unselectRow('row-1')`                | Programmatically unselect a row (and its group if `groupMode: 'group'`).                           |
| `selectAllOnPage()`       | `table.selectAllOnPage()`                   | Select all parent rows on the current page.                                                         |
| `unselectAllOnPage()`     | `table.unselectAllOnPage()`                 | Unselect all parent rows on the current page.                                                       |
| `clearSelection()`        | `table.clearSelection()`                    | Clear selection for all rows on all pages.                                                          |
| `getTableElement()`       | `table.getTableElement()`                   | Get underlying `<table>` element.                                                                   |
| `getHeaderElement()`      | `table.getHeaderElement()`                  | Get `<thead>` element.                                                                              |
| `getBodyElement()`        | `table.getBodyElement()`                    | Get `<tbody>` element.                                                                              |
| `getFooterElement()`      | `table.getFooterElement()`                  | Get `<tfoot>` element (if footer is enabled).                                                       |
| `getPagerElement()`       | `table.getPagerElement()`                   | Get pager container element (if paging is enabled).                                                 |
| `getDom()`                | `table.getDom()`                            | Get a structured object `{ wrapper, table, thead, tbody, tfoot, pager }`.                          |


## 6. Raw row data on `<tr>`

Every **data row** (parent or child) is rendered as:

```html
<tr data-row-key="..." data-row-data="{...JSON...}">...</tr>
```

Usage example: delegate click event on body and get raw data:

```js
var tbody = table.getBodyElement();

tbody.addEventListener('click', function (e) {
  var tr = e.target.closest('tr');
  if (!tr || !tr.dataset.rowData) return;
  try {
    var row = JSON.parse(tr.dataset.rowData);
    console.log('Clicked row raw data:', row);
  } catch (err) {
    console.error('Could not parse row data', err);
  }
});
```

Note: if your row objects contain functions, circular references, or non-serializable values, this will be skipped for that row.

---

## 7. Example scenarios

### 7.1 Admin users table with selection + child rows + highlighting

```js
var users = [
  {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
    role: 'Admin',
    status: 'Active',
    lastLogin: '2025-11-20',
    children: [
      { id: '1.1', action: 'Login',        date: '2025-11-20', ip: '192.168.0.1' },
      { id: '1.2', action: 'Change role',  date: '2025-11-19', ip: '192.168.0.2' }
    ]
  },
  // ...
];

var table = new TinyDataTable('#admin-users', {
  columns: [
    { key: 'id',        title: 'ID',        sortable: true, className: 'text-right' },
    { key: 'name',      title: 'Name',      sortable: true },
    { key: 'email',     title: 'Email',     sortable: true },
    { key: 'role',      title: 'Role',      sortable: true },
    { key: 'status',    title: 'Status',    sortable: true },
    { key: 'lastLogin', title: 'Last login', sortable: true }
  ],
  data: users,
  paging: { enabled: true, pageSize: 10 },
  childRows: {
    enabled: true,
    dataKey: 'children',
    rowId: function (row) { return row.id; },
    toggleOnRowClick: true,
    columns: [
      { key: 'id',     title: '#',     visible: true },
      { key: 'action', title: 'Action' },
      { key: 'date',   title: 'Date' },
      { key: 'ip',     title: 'IP address' }
    ]
  },
  select: true,
  highlight: {
    enabled: true,
    contextSelector: 'tbody',
    markOptions: {
      className: 'tt-highlight',
      separateWordSearch: true
    }
  }
});

// Search box
document.querySelector('#search-admin').addEventListener('input', function () {
  table.search(this.value);
});

// Log selected
document.querySelector('#log-selected').addEventListener('click', function () {
  console.log('Selected user keys:', table.getSelectedRowKeys());
  console.log('Selected user rows:', table.getSelectedRows());
});
```

### 7.2 Orders table with grouping + merged totals + group-level selection

```js
var orders = [
  { orderId: 'A-1001', paymentType: 'Card', item: 'Item A', qty: 1, price: 50,  total: 70,  customer: 'Alice',   date: '2025-11-01' },
  { orderId: 'A-1001', paymentType: 'Card', item: 'Item B', qty: 2, price: 10,  total: 70,  customer: 'Alice',   date: '2025-11-01' },
  { orderId: 'B-2001', paymentType: 'Cash', item: 'Item C', qty: 3, price: 15,  total: 45,  customer: 'Bob',     date: '2025-11-02' },
  { orderId: 'C-3001', paymentType: 'Card', item: 'Service A', qty: 1, price: 120, total: 150, customer: 'Carol', date: '2025-11-02' },
  { orderId: 'C-3001', paymentType: 'Card', item: 'Service B', qty: 1, price: 30,  total: 150, customer: 'Carol', date: '2025-11-02' }
];

function renderGroupHeader(info) {
  var first = info.rows[0] || {};
  return 'Order ' + info.values.orderId +
         ' (' + info.values.paymentType + ') - ' +
         (first.customer || '') + ' - ' + (first.date || '');
}

var table = new TinyDataTable('#orders', {
  columns: [
    { key: 'orderId',     title: 'Order',      sortable: true },
    { key: 'paymentType', title: 'Payment',    sortable: true },
    { key: 'customer',    title: 'Customer',   sortable: true },
    { key: 'date',        title: 'Date',       sortable: true },
    { key: 'item',        title: 'Item',       sortable: true },
    { key: 'qty',         title: 'Qty',        sortable: true, className: 'text-right' },
    {
      key: 'price',
      title: 'Price',
      sortable: true,
      className: 'text-right',
      render: function (v) {
        return v != null ? v.toLocaleString('de-CH', { minimumFractionDigits: 2 }) : '';
      }
    },
    {
      key: 'total',
      title: 'Total',
      sortable: true,
      className: 'text-right',
      render: function (v) {
        return v != null ? v.toLocaleString('de-CH', { minimumFractionDigits: 2 }) : '';
      }
    }
  ],
  data: orders,
  paging: { enabled: true, pageSize: 10 },
  grouping: {
    enabled: true,
    keys: ['orderId', 'paymentType'],
    mergeColumns: ['total'],
    header: {
      show: true,
      render: renderGroupHeader
    }
  },
  footer: {
    enabled: true,
    sumColumns: ['total']
  },
  select: {
    enabled: true,
    groupMode: 'group'  // one checkbox per group
  }
});

// Log selection
table.on('select', function (info) {
  console.log('Order selection changed:', info.selectedRowKeys);
});
```

### 7.3 Ajax + mark.js + selection

```js
var table = new TinyDataTable('#ajax-users', {
  columns: [
    { key: 'id',    title: 'ID',    sortable: true },
    { key: 'name',  title: 'Name',  sortable: true },
    { key: 'email', title: 'Email', sortable: true }
  ],
  ajax: {
    fetch: function ({ state }) {
      return fetch('/api/users?' + new URLSearchParams({
        page: state.page,
        pageSize: state.pageSize,
        search: state.searchText || '',
        sortKey: state.sortKey || '',
        sortDir: state.sortDir || ''
      }))
        .then(function (res) { return res.json(); })
        .then(function (json) {
          return { rows: json.items, total: json.total };
        });
    }
  },
  paging: {
    enabled: true,
    pageSize: 25,
    pageSizeOptions: [10, 25, 50, 100],
    serverSide: true
  },
  select: true,
  highlight: {
    enabled: true,
    contextSelector: 'tbody',
    markOptions: {
      className: 'tt-highlight',
      separateWordSearch: true
    }
  }
});

// Hook a search input
document.querySelector('#ajax-search').addEventListener('input', function () {
  table.search(this.value);
});
```

---

## 8. CSS / theming

All classes are namespaced under `tiny-table`. Key classes:

- `.tiny-table`: root table.
- `.tiny-table-wrapper`: scroll wrapper around the table (used when `scrollX` or `scrollY` is enabled).
- `.tiny-table-empty-cell`: cell used for the empty state row (when there are no rows); spans all visible columns.
- `.tiny-table-sorted-asc`, `.tiny-table-sorted-desc`: header sort indicators.
- `.tiny-table-child-row`: child row styling.
- `.tiny-table-has-children`: parent row that has children.
- `.tiny-table-toggle-icon`: expand/collapse icon.
- `.tiny-table-group-header-row`, `.tiny-table-group-header-cell`: group header styling.
- `.tiny-table-select-header-cell`, `.tiny-table-select-cell`: selection column cells.
- `.tiny-table-pager`, `.tiny-table-pager-inner`, `.tiny-table-length`, `.tiny-table-info`, `.tiny-table-pages`: pager elements.
- `.tiny-table-page-active`: active page button.
- `.tiny-table-ellipsis`: pagination ellipsis element.
- `.tt-highlight`: default highlight class used with mark.js (configurable via `markOptions`).

You can override or extend these in your own stylesheet.

For example, to style the empty state row:

```css
.tiny-table-empty-cell {
  text-align: center;
  font-style: italic;
  color: #6b7280;
}
```

---

This should give you a complete view of how TinyDataTable works, with enough examples to adapt it to real-world use (admin tables, order lists, logs, etc.).
