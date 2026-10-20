// Products that live only in the POS (migration 0083) are offered in the Sales grid
// next to the website's own products, the same way add-ons are: as entries of a
// synthetic category, with an id that can never be a storefront id. SalesClient
// recognises the "pos:" prefix and charges the POS product directly instead of
// looking for a website link. (Kept apart from posOnlyProducts.ts so the client can
// import it without pulling in the database client.)
export const POS_ONLY_CATEGORY_ID = "__pos_only__";
export const POS_ONLY_ENTRY_PREFIX = "pos:";
