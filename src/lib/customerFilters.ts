// Filters + ranking for the Marketing > CRM customer list. They live in the page
// URL (?sort=&state=&gender=&age=&since_from=&since_to=) so a filtered view can be
// reloaded or shared; parseCustomerFilters() turns those params into a clean
// value (anything unknown or malformed is dropped rather than trusted).

export type CustomerSort = "name" | "spent" | "orders" | "units";

export type CustomerFilters = {
  sort: CustomerSort;
  state: string;
  gender: string;
  age: string;
  // Customer-since range, YYYY-MM-DD, inclusive. "" = open ended.
  sinceFrom: string;
  sinceTo: string;
  // Bought-on range, YYYY-MM-DD, inclusive: only customers with an order dated in
  // it, counting only those orders. One day = from and to the same date.
  boughtFrom: string;
  boughtTo: string;
};

// "Top buyers" sorts rank customers by what they bought (their orders:
// not cancelled or voided, matched to the customer the same way as their
// purchase history: by customer link or by phone) and leave out customers who
// haven't bought anything.
export const CUSTOMER_SORT_LABELS: Record<CustomerSort, string> = {
  name: "Name A–Z",
  spent: "Top buyers: most spent",
  orders: "Top buyers: most orders",
  units: "Top buyers: most products",
};

export const NO_CUSTOMER_FILTERS: CustomerFilters = {
  sort: "name",
  state: "",
  gender: "",
  age: "",
  sinceFrom: "",
  sinceTo: "",
  boughtFrom: "",
  boughtTo: "",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseCustomerFilters(p: {
  sort?: string;
  state?: string;
  gender?: string;
  age?: string;
  since_from?: string;
  since_to?: string;
  bought_from?: string;
  bought_to?: string;
}): CustomerFilters {
  const sort = (p.sort ?? "") as CustomerSort;
  return {
    sort: sort in CUSTOMER_SORT_LABELS ? sort : "name",
    state: (p.state ?? "").trim(),
    gender: (p.gender ?? "").trim(),
    age: (p.age ?? "").trim(),
    sinceFrom: DAY.test(p.since_from ?? "") ? p.since_from! : "",
    sinceTo: DAY.test(p.since_to ?? "") ? p.since_to! : "",
    boughtFrom: DAY.test(p.bought_from ?? "") ? p.bought_from! : "",
    boughtTo: DAY.test(p.bought_to ?? "") ? p.bought_to! : "",
  };
}

// What a customer has bought -- shown next to the customer in the list.
export type CustomerBuying = { orders: number; units: number; spent: number };
