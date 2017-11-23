/*
Fix slow query execution times by adding an index on mem_accounts2delegates ("dependentId")
Before index fix:
```
ark_mainnet=> EXPLAIN (ANALYZE) UPDATE mem_accounts m
SET vote = (SELECT COALESCE(SUM(b.balance), 0) AS vote
            FROM mem_accounts2delegates a, mem_accounts b
            WHERE a."accountId" = b.address AND a."dependentId" = encode(m."publicKey", 'hex'))
WHERE m."isDelegate" = 1;
Update on mem_accounts m  (cost=0.00..571465.84 rows=601 width=345) (actual time=2801.314..2801.314 rows=0 loops=1)
 ->  Seq Scan on mem_accounts m  (cost=0.00..571465.84 rows=601 width=345) (actual time=8.935..2778.252 rows=594 loops=1)
       Filter: ("isDelegate" = 1)
       Rows Removed by Filter: 36990
       SubPlan 1
         ->  Aggregate  (cost=947.02..947.03 rows=1 width=8) (actual time=4.657..4.657 rows=1 loops=594)
               ->  Nested Loop  (cost=0.41..946.87 rows=61 width=8) (actual time=3.052..4.650 rows=23 loops=594)
                     ->  Seq Scan on mem_accounts2delegates a  (cost=0.00..447.88 rows=61 width=35) (actual time=3.043..4.478 rows=23 loops=594)
                           Filter: (("dependentId")::text = encode(m."publicKey", 'hex'::text))
                           Rows Removed by Filter: 13392
                     ->  Index Scan using mem_accounts_pkey on mem_accounts b  (cost=0.41..8.17 rows=1 width=43) (actual time=0.007..0.007 rows=1 loops=13415)
                           Index Cond: ((address)::text = (a."accountId")::text)
Planning time: 0.639 ms
Trigger protect_mem_accounts: time=13.702 calls=594
Execution time: 2801.446 ms
```
After creating index fix:
```
ark_mainnet=> EXPLAIN (ANALYZE) UPDATE mem_accounts m
SET vote = (SELECT COALESCE(SUM(b.balance), 0) AS vote
            FROM mem_accounts2delegates a, mem_accounts b
            WHERE a."accountId" = b.address AND a."dependentId" = encode(m."publicKey", 'hex'))
            WHERE m."isDelegate" = 1;
Update on mem_accounts m  (cost=0.00..387200.62 rows=601 width=345) (actual time=120.801..120.801 rows=0 loops=1)
 ->  Seq Scan on mem_accounts m  (cost=0.00..387200.62 rows=601 width=345) (actual time=0.100..106.916 rows=594 loops=1)
       Filter: ("isDelegate" = 1)
       Rows Removed by Filter: 36990
       SubPlan 1
         ->  Aggregate  (cost=640.42..640.43 rows=1 width=8) (actual time=0.164..0.164 rows=1 loops=594)
               ->  Nested Loop  (cost=5.29..640.27 rows=60 width=8) (actual time=0.017..0.160 rows=23 loops=594)
                     ->  Bitmap Heap Scan on mem_accounts2delegates a  (cost=4.88..145.72 rows=60 width=35) (actual time=0.013..0.024 rows=23 loops=594)
                           Recheck Cond: (("dependentId")::text = encode(m."publicKey", 'hex'::text))
                           Heap Blocks: exact=4125
                           ->  Bitmap Index Scan on "mem_accounts2delegates_dependentId_idx"  (cost=0.00..4.86 rows=60 width=0) (actual time=0.011..0.011 rows=23 loops=594)
                                 Index Cond: (("dependentId")::text = encode(m."publicKey", 'hex'::text))
                     ->  Index Scan using mem_accounts_pkey on mem_accounts b  (cost=0.41..8.23 rows=1 width=43) (actual time=0.005..0.005 rows=1 loops=13415)
                           Index Cond: ((address)::text = (a."accountId")::text)
Planning time: 0.517 ms
Trigger protect_mem_accounts: time=7.787 calls=594
Execution time: 120.902 ms
```
*/

BEGIN;

CREATE INDEX IF NOT EXISTS "mem_accounts2delegates_dependentId" ON mem_accounts2delegates ("dependentId");

COMMIT;