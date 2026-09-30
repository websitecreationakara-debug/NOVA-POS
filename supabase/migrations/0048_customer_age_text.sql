-- The customer CSV's Age column holds age ranges ("25-34", "55+"), not
-- numbers, so a whole-number column dropped almost every value on import.
-- Text keeps the ranges; existing numeric ages convert losslessly ("31").
alter table customers alter column age type text using age::text;
