"use strict";
/** Общие константы и настройки по умолчанию. */

const VIEW_TYPE = "tag-refactor-auditor-view";
const DEFAULT_SETTINGS = {
  previewChars: 400,
  caseSensitive: false,
  ignoredFolders: ["Templates"],
  createdDateProperty: "",
  // Used when createdDateProperty is empty: "ctime" (file created) or "mtime" (file modified).
  fileDateField: "ctime",
  minTagMentions: 0
};
// Frontmatter keys never offered as a date source.
const NON_DATE_PROPERTIES = new Set(["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "publish"]);
const PREVIEW_PAGE_SIZE = 8;
const BULK_PAGE_SIZE = 60;
const FILE_SELECT_PAGE_SIZE = 200;
// Tag catalog rows rendered per portion while scrolling.
const CATALOG_PAGE_SIZE = 250;

module.exports = { VIEW_TYPE, DEFAULT_SETTINGS, NON_DATE_PROPERTIES, PREVIEW_PAGE_SIZE, BULK_PAGE_SIZE, FILE_SELECT_PAGE_SIZE, CATALOG_PAGE_SIZE };
