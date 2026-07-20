# Migration notes

The initial migration enables PostGIS before creating geography columns, then adds GiST indexes, partial unique indexes and domain check constraints that Prisma cannot express.

Production changes follow expand/migrate/contract. Do not edit an already-applied migration; use a forward-fix migration. Application rollback is allowed only while the deployed schema remains backward compatible.
