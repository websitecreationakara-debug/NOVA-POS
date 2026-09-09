-- Add a "Pre-Order" fulfilment state, ordered ahead of "new_order": the
-- customer has reserved the item but the order isn't in the normal
-- pickup/delivery pipeline yet.

alter type fulfillment_status add value if not exists 'pre_order' before 'new_order';
