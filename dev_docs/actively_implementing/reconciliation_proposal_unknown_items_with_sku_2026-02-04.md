## Reconciliation proposal: server "Unknown item" rows vs offline export

- Offline export: `dev_docs/actively_implementing/ledger-offline-export-1dd4fd75-8eea-4f7a-98e7-bf45b987ae94-2026-02-04T00_38_12.342Z.json` (exportedAt: 2026-02-04T00:38:12.342Z)
- Account: `1dd4fd75-8eea-4f7a-98e7-bf45b987ae94`

### Key finding

This offline export does **not** contain the item records for any of the server-side items whose description contains `"Unknown item"` and that have a non-empty SKU.

- Server "Unknown item" items with SKU: **39**
- Offline items in export: **827**
- Offline items that match any server "Unknown item" SKU (exact string match): **0**
- Offline items that match any server "Unknown item" itemId: **0**

All 39 server items **do** have their parent transaction present in the export, so we can at least link each unknown item to:

- the transaction receipt images
- the transaction notes text (often includes a human summary of what was purchased)

### Practical proposal

Because the per-item details (the `items[]` rows themselves) are missing from this export for the 39 server placeholders, there’s nothing reliable to auto-fill from this export into the server `items` rows (beyond what the server rows already contain).

What we *can* do with this export is provide a worklist that links each server placeholder item to its transaction context so you can quickly correct/merge/delete those placeholders.

### Worklist (server items → offline transaction context)

| SKU | Server itemId | TransactionId | Tx date | Receipt imgs | Tx notes (preview) |
|---:|---|---|---|---:|---|
| 051729 | I-1770107273786-kjbo | 24689cf9-b604-4ce9-819c-cd4ac187e14f | 2026-01-09 | 1 | 2 round beige stone top w/ wood base accent tables, beige stone accent “T” table, 2 black string framed wall art for floating shelves, “misc” gray velvet pillow / REGULAR SALE |
| 375357 | I-1770107027673-7vqj | 7638e8ad-c8ce-427c-8914-55542e927107 | 2026-01-09 | 2 | Double white glass shade vintage library-style desk lamp, pot of broccoli-like greenery, accessories, pillows, wall art / REGULAR SALE |
| 183064 | I-1770106222382-bd0g | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 203439 | I-1770106175448-78ei | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 354992 | I-1770106145982-sueb | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 346673 | I-1770106120765-hpid | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 363728 | I-1770106081355-9bs8 | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 139866 | I-1770106055604-ecck | 53ef2f6b-5018-4f95-aee8-fd05a7c9602e | 2025-12-22 | 1 | Lamps, throws, black mushroom floor lamp (2 of 2), decorative accessories, light olive green 8x 10 rug, pillows / REGULAR SALE |
| 198196 | I-1770105399507-zza7 | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 313852 | I-1770105355257-cgmo | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 364886 | I-1770105317539-nldd | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 359006 | I-1770105277758-fncl | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 359006 | I-1770105257024-wr4e | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 369900 | I-1770105207811-lqmm | 1b959c8a-73c7-45d8-8600-dfd6f94f74c8 | 2025-12-22 | 1 | Pillows, wood/ marble accent table, wall art, olive green recliner, marble coasters, black mushroom floor lamp, large agate rock (No Email Receipt) / REGULAR SALE |
| 347794 | I-1770103949908-m9ir | a368171c-8db8-43f7-b2ba-988a616a2023 | 2025-12-01 | 2 | Wood book holder; throw pillows; wood curved nightstand; bronze mushroom floor lamp / REGULAR SALE |
| 364027 | I-1770103261499-ws6a | dd8fa985-b06c-406e-98e2-3db3e6aa9fb8 | 2025-12-01 | 1 | Wall art; 3 succulents in black pots; chenille lg down pillow for sofa / REGULAR SALE |
| 317591 | I-1770103214871-qn07 | dd8fa985-b06c-406e-98e2-3db3e6aa9fb8 | 2025-12-01 | 1 | Wall art; 3 succulents in black pots; chenille lg down pillow for sofa / REGULAR SALE |
| 313348 | I-1770103180335-5d8c | dd8fa985-b06c-406e-98e2-3db3e6aa9fb8 | 2025-12-01 | 1 | Wall art; 3 succulents in black pots; chenille lg down pillow for sofa / REGULAR SALE |
| 320168 | I-1770103000316-0bw7 | 55b05bea-8985-4321-b686-070a36b42422 | 2025-12-01 | 1 | Large Wall art; 2- packs of 4-pc agate small wall art; camel fur throw; succulents in black pot / REGULAR SALE |
| 313852 | I-1770102916812-ihcv | 55b05bea-8985-4321-b686-070a36b42422 | 2025-12-01 | 1 | Large Wall art; 2- packs of 4-pc agate small wall art; camel fur throw; succulents in black pot / REGULAR SALE |
| 350819 | I-1770102254593-1mhc | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 348766 | I-1770102186891-izag | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 350814 | I-1770102075079-k7ih | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 348773 | I-1770101885757-ys81 | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 343846 | I-1770101688343-yu8s | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 343846 | I-1770101672689-jyg7 | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 343847 | I-1770101588306-sd03 | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 314137 | I-1770101402622-4a33 | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 313343 | I-1770101219986-bmsk | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 313343 | I-1770101213103-ewmu | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 309743 | I-1770101109686-4nxu | ad34f924-7a44-4149-9beb-e7272536bbb5 | 2025-11-01 | 1 | Found in email during audit, unsure items. / Sku's: |
| 351559 | I-1770100881035-nqhj | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 356128 | I-1770100841435-u3h6 | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 293357 | I-1770100622837-zjgq | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 350822 | I-1770100567635-cdk0 | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 353116 | I-1770100493979-1pr6 | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 350822 | I-1770100437748-ebip | 27a034d1-caec-4034-a192-e64bb3e241dd | 2025-10-31 | 2 | 2 cowhide ottomans (USED AT KEN & DANITA’S HOUSE - swapping sku w/ tbd item - Camel Leather Pouf Ottoman); glazed pottery for family room floating shelves; wall art / REGULAR SALE |
| 324426 | I-1770100296130-u0zc | b7236b71-c072-4cd1-a03a-5da9c39b9d30 | 2025-10-21 | 1 | Wood round nightstand; $99.99 decorative accessory / REGULAR SALE |
| 348168 | I-1770098890257-3jk4 | c439dd23-4525-47f0-be19-b7a3542bdb15 | 2025-10-19 | 1 | King olive layering blanket; 2 brass pencil lamps with gray stone base; (2 of 2) glass lamp with brass stem; decorative accessory for $49.99 (348168)(?) / REGULAR SALE |
