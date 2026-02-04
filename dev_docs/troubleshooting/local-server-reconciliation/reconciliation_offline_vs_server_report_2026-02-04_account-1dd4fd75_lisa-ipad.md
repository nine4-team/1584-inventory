## Offline vs Server reconciliation (read-only)

Account: `1dd4fd75-8eea-4f7a-98e7-bf45b987ae94`  
Exported at: `2026-02-04T02:27:09.873Z`  
Report JSON: `dev_docs/troubleshooting/local-server-reconciliation/reconciliation_offline_vs_server_report_2026-02-04_account-1dd4fd75_lisa-ipad.json`

### Summary
- **Server items**: 785
- **Offline items**: 641
- **Offline-only items (missing on server)**: **2**
- **Server-only items (missing offline)**: **146**
- **Items with scalar diffs**: **97**
- **Items with images diffs**: **1**

- **Server transactions**: 173
- **Offline transactions**: 134
- **Offline-only transactions (missing on server)**: **0**
- **Server-only transactions (missing offline)**: **39**
- **Transactions with scalar diffs**: **94**
- **Transactions with itemIds diffs**: **0**
- **Transactions with images diffs**: **0**

- **Server projects**: 2
- **Offline projects**: 2
- **Projects missing on server**: **0**
- **Projects missing offline**: **0**
- **Projects with diffs**: **2**

### Key findings
- The offline export is missing a significant chunk of server state (items + transactions). This usually means the local cache is incomplete or out-of-date for this account on this device.
- For items that exist on both sides, the most common differing fields are: `lastUpdated` (97), `createdAt` (97), `space` (86), `latestTransactionId` (37), `transactionId` (36), `taxRatePct` (34), `taxAmountPurchasePrice` (10), `taxAmountProjectPrice` (8)
- For transactions that exist on both sides, the most common differing fields are: `sumItemPurchasePrices` (94)

### What’s missing on the server (offline-only)

#### Offline-only items (2)

| itemId | description | source | sku | purchasePrice | projectPrice | marketValue | paymentMethod | disposition | dateCreated | lastUpdated | last_synced_at | imagesCount | qrKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `I-1767120930216-3asx` | Gold & black mushroom-style floor lamp | Homegoods | 198196 | 79.99 | 79.99 | 189.00 | Client Card | purchased | 2025-12-30 | 2025-12-31T20:21:42.328894+00:00 | 2026-01-06T03:50:55.216Z | 2 | `qr_1767120930187_vlt4cqi1g` |
| `I-1767132092775-dtx2` | Round marble top/ wood base accent table | Homegoods | 249953 | 79.99 | 79.99 | 249.99 | Client Card | purchased | 2025-12-30 | 2025-12-31T20:21:42.328894+00:00 | 2026-01-06T03:50:55.215Z | 2 | `qr_1767132092747_jrhjfcrqq` |

### What’s missing offline (server-only)

#### Server-only items (146)

Top 30 by `last_updated` (full list is in the JSON report under `reconciliation.items.serverOnly`).

| itemId | description | source | sku | purchasePrice | disposition | dateCreated | lastUpdated | imagesCount |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `I-1768243948674-q9rf` | Brown leather bench with black metal leg frame | Homegoods | 045802 | 249.99 | purchased | 2026-01-12 | 2026-02-03 07:05:34.568+00 | 2 |
| `I-1768244259678-edxc` | Black round wood accent table | Homegoods | *(empty)* | 79.99 | purchased | 2026-01-12 | 2026-02-03 05:03:51.846+00 | 1 |
| `I-1768244379335-p6kc` | Black round wood accent table | Homegoods | 374376 | 79.99 | purchased | 2026-01-12 | 2026-02-03 09:12:09.064+00 | 1 |
| `I-1768245622453-jn28` | Taupe stone “T” accent table | Homegoods | 335774 | 129.99 | purchased | 2026-01-12 | 2026-02-03 04:22:08.82+00 | 2 |
| `I-1768245769528-xfcz` | Taupe round stone top accent table w/ wood base | Homegoods | 253923 | 149.99 | purchased | 2026-01-12 | 2026-02-03 04:22:10.871+00 | 2 |
| `I-1768245933838-trg6` | Small square black string wall art | Homegoods | 318772 | 34.99 | purchased | 2026-01-12 | 2026-02-03 04:22:09.769+00 | 2 |
| `I-1768245947145-55uu` | Small square black string wall art | Homegoods | 318772 | 34.99 | purchased | 2026-01-12 | 2026-02-03 04:22:10.27+00 | 2 |
| `I-1768246087497-b7ss` | Large fabric textured canvas wood framed wall art | Homegoods | 320650 | 129.99 | purchased | 2026-01-12 | 2026-02-03 04:22:09.309+00 | 2 |
| `I-1768246162319-xp7i` | 10’x 14’ Ochre speckled wool rug | Rugs USA | *(empty)* | 799.99 | purchased | 2026-01-12 | 2026-01-12 19:30:47.425+00 | 1 |
| `I-1768246434907-a7pj` | Black & ivory wool rug runner 3’x 10’ | Etsy | *(empty)* | 400.00 | purchased | 2026-01-12 | 2026-01-12 19:35:34.098+00 | 1 |
| `I-1768247053660-5897` | Maroon throw with fringe edges | Homegoods | 131163 | 59.99 | purchased | 2026-01-12 | 2026-02-03 04:16:16.289+00 | 2 |
| `I-1768247198810-dgxa` | Dark gray knitted throw | Homegoods | 136104 | 39.99 | purchased | 2026-01-12 | 2026-02-03 04:16:16.747+00 | 2 |
| `I-1768247365499-qmte` | Cocogió Italian Khaki knitted wool throw | Homegoods | 131304 | 39.99 | purchased | 2026-01-12 | 2026-02-03 04:16:15.757+00 | 2 |
| `I-1768250578476-z703` | Black paper circles design framed wall art | Homegoods | 323262 | 79.99 | purchased | 2026-01-09 | 2026-02-03 04:20:24.449+00 | 2 |
| `I-1768251026531-3uc8` | Midnight blue/ white striated small tulip vase | Homegoods | 331124 | 16.99 | purchased | 2026-01-12 | 2026-02-03 04:15:36.939+00 | 2 |
| `I-1768251037208-a8pm` | Midnight blue/ white striated small tulip vase | Homegoods | 331124 | 16.99 | purchased | 2026-01-12 | 2026-02-03 04:15:36.447+00 | 2 |
| `I-1768251209315-27jn` | Sage green terra cotta vase w/ handle | Homegoods | 335747 | 19.99 | purchased | 2026-01-12 | 2026-02-03 04:15:35.958+00 | 2 |
| `I-1768251385853-4gef` | Glass lamp with brass center & base | Homegoods | 197935 | 89.99 | purchased | 2025-12-30 | 2026-02-03 04:48:52.795+00 | 2 |
| `I-1768251590255-zlf1` | Rudolph Upholstered Pouf | Wayfair | B000970369 | 120.28 | purchased | 2025-12-09 | 2026-01-12 20:59:50.255+00 | 1 |
| `I-1768252035597-5sww` | Vintage style double white glass shade library lamp | Homegoods | 520667 | 79.99 | purchased | 2026-01-12 | 2026-02-03 04:20:26.098+00 | 2 |
| `I-1768252253797-2q67` | Victoria Hagan “Live Now” coffee table book | Homegoods | 361570 | 34.99 | purchased | 2026-01-12 | 2026-02-03 04:20:27.349+00 | 2 |
| `I-1768252346127-t9hm` | “Made for Living” book | Homegoods | 374838 | 19.99 | purchased | 2026-01-12 | 2026-02-03 04:20:26.734+00 | 2 |
| `I-1768252543683-ke9h` | White oval stone tray with gold legs | Homegoods | 346652 | 49.99 | purchased | 2026-01-12 | 2026-02-03 04:20:25.535+00 | 2 |
| `I-1768252832664-xnq3` | Travertine pedestal bowl  | Homegoods | *(empty)* | *(empty)* | purchased | 2026-01-12 | 2026-01-20 19:32:51.641+00 | 0 |
| `I-1768253148087-y26y` | Large Petrified wood ochre slice (tray) | Homegoods | 372468 | 39.99 | purchased | 2026-01-12 | 2026-02-03 04:20:27.85+00 | 2 |
| `I-1768253542869-ztlc` | Round gold metal tray with round handles | Homegoods | 329294 | 24.99 | purchased | 2026-01-12 | 2026-02-03 04:15:37.557+00 | 2 |
| `I-1768253559514-dqhr` | Round gold metal tray with round handles | Homegoods | 329294 | 24.99 | purchased | 2026-01-12 | 2026-02-03 04:15:38.106+00 | 2 |
| `I-1768253704971-wdro` | Rectangle gold metal tray w/ rectangle handles | Homegoods | 329340 | 24.99 | purchased | 2026-01-12 | 2026-02-03 04:15:35.451+00 | 2 |
| `I-1768253854621-92ne` | Black and gold modern metal library table lamp | Homegoods | 520846 | 59.99 | purchased | 2026-01-12 | 2026-02-03 04:21:20.159+00 | 2 |
| `I-1768253862065-e79p` | Black and gold modern metal library table lamp | Homegoods | 520846 | 59.99 | purchased | 2026-01-12 | 2026-02-03 04:21:19.689+00 | 2 |

#### Server-only transactions (39)

| transactionId | transactionDate | source | amount | status | description |
| --- | --- | --- | --- | --- | --- |
| `15b3fc0d-7e12-490a-866d-6fe3bbd51f44` | 2026-02-01 | Homegoods | 365.00 | pending | *(empty)* |
| `be3d1c11-dd49-4abf-b8c1-ee8f03f22962` | 2026-02-01 | Homegoods | 576.44 | pending | *(empty)* |
| `702a72cb-f8ff-4324-ae3e-3738184026c1` | 2026-01-31 | Hobby Lobby | 257.05 | pending | *(empty)* |
| `cfcac9ca-87f2-4d96-a8c3-47586614f08a` | 2026-01-31 | Homegoods | 320.73 | pending | *(empty)* |
| `dbe5b0ec-bdaf-4d58-b99a-5e3cc7ddfbc9` | 2026-01-31 | Homegoods | 795.24 | pending | *(empty)* |
| `f95a39e6-63a0-496a-90b1-e54c4bde3bc3` | 2026-01-31 | Homegoods | 530.99 | pending | *(empty)* |
| `12f20735-a18d-43f4-bc55-54f3fd9765be` | 2026-01-30 | Lowe’s | 283.30 | pending | *(empty)* |
| `b3bb3f97-b9de-4c1e-ab07-75137bee2c50` | 2026-01-30 | Hobby Lobby | 49.24 | pending | *(empty)* |
| `4050bcd1-71da-49a4-9f26-8341946b0103` | 2026-01-29 | Homegoods | 494.05 | pending | *(empty)* |
| `ce3d91b7-0e97-4be1-ad49-c431f750d9ea` | 2026-01-29 | Homegoods | 704.26 | pending | *(empty)* |
| `08495209-a834-4889-b1ef-7d2c97f16a7a` | 2026-01-28 | Homegoods | 458.72 | pending | *(empty)* |
| `3cf1b241-e08b-48af-ae1d-151b640648f5` | 2026-01-28 | Marshalls | 40.08 | pending | *(empty)* |
| `580388ea-3a62-4ae6-8c4a-bfdf3ea1c0ca` | 2026-01-28 | Ross | 90.97 | pending | *(empty)* |
| `6ed422f3-299e-43db-89c1-545ee826c069` | 2026-01-28 | Homegoods | 173.38 | pending | *(empty)* |
| `97c03bee-18cf-4e57-ab10-c30e4893cb58` | 2026-01-28 | Homegoods | 60.65 | pending | *(empty)* |
| `b5b3df4f-15d2-42e2-9036-4202e33388bd` | 2026-01-28 | Homegoods | 75.85 | pending | *(empty)* |
| `d32915cf-ea75-4e22-a9d1-5d85b64b2f96` | 2026-01-28 | Homegoods | 949.18 | pending | *(empty)* |
| `f1d787de-a512-4cac-a813-f1b4927c7514` | 2026-01-28 | Homegoods | 86.69 | pending | *(empty)* |
| `fc8fb290-545a-4e1a-8f47-dbfbc39701a6` | 2026-01-27 | Homegoods | 1000.00 | pending | *(empty)* |
| `c368bf90-96ab-4522-a7b3-4218160d1bd3` | 2026-01-25 | Homegoods | 1046.61 | pending | *(empty)* |
| `e33f10c0-c9fc-4169-bd96-fcbb17547d97` | 2026-01-25 | Homegoods | 1104.08 | pending | *(empty)* |
| `7d9576db-ee38-4069-877a-23b49dec9629` | 2026-01-24 | Hobby Lobby | 140.23 | pending | *(empty)* |
| `5fe8b85e-ba80-4698-be5a-edde5be10c67` | 2026-01-23 | Hobby Lobby | 257.44 | pending | *(empty)* |
| `0c3adf96-c689-47bd-ba13-6529c3e063e8` | 2026-01-15 | Homegoods | 1687.00 | pending | *(empty)* |
| `61850397-8adc-4d7b-a2be-98ae1405345e` | 2026-01-15 | Homegoods | 499.80 | pending | *(empty)* |
| `f114ed83-1814-46ff-9ee9-1aa1d3e46060` | 2026-01-15 | At Home | 419.20 | pending | *(empty)* |
| `f931f9fa-fa57-40aa-b71d-74755c3fd3a1` | 2026-01-15 | Homegoods | 173.28 | pending | *(empty)* |
| `4314671a-5a81-4826-b1e6-12cfefcaa5b7` | 2026-01-13 | Homegoods | 647.66 | pending | *(empty)* |
| `e32cfa2d-ef87-4606-b01a-4694696db0b6` | 2026-01-13 | Homegoods | 365.00 | pending | *(empty)* |
| `04699637-1cd9-4701-bba8-727e6e8c2545` | 2026-01-11 | Homegoods | 347.97 | completed | *(empty)* |
| `63fe2f79-2170-4069-869f-444cbfa09e81` | 2026-01-11 | Homegoods | 351.07 | completed | *(empty)* |
| `6847e906-3111-4fd3-beca-c85462bf0311` | 2026-01-11 | Homegoods | 211.29 | completed | *(empty)* |
| `a2868db4-bb4f-4678-8195-e55113360e8a` | 2026-01-11 | Homegoods | 1380.96 | pending | *(empty)* |
| `a9b3a52e-1894-44fb-8bdc-fc8ee394a335` | 2026-01-11 | Homegoods | 689.04 | completed | *(empty)* |
| `e013cfe7-afde-4393-882f-f60eae396288` | 2026-01-11 | Homegoods | 659.83 | pending | *(empty)* |
| `2327928a-6311-4c00-bfea-bc29bcc47c1c` | 2026-01-09 | Homegoods | 351.07 | completed | *(empty)* |
| `aabd966b-0bc5-470e-8d40-8d77bd97b9a4` | 2026-01-09 | Homegoods | 211.29 | completed | *(empty)* |
| `cd7a4107-03eb-45ee-aeba-5f4fff6e6251` | 2026-01-09 | Homegoods | 689.04 | completed | *(empty)* |
| `dec82559-eb5d-40ea-a2f3-d2434c489a34` | 2026-01-09 | Homegoods | 659.83 | completed | *(empty)* |

### Items that exist on both sides but differ

- Total: **97**
- Full per-field diffs are in the JSON report under `reconciliation.items.diffs`.
- IDs: `I-1766857168908-i03m`, `I-1766865267318-bfzd`, `I-1766865942608-vu71`, `I-1766866132746-7foh`, `I-1766866142237-fgwm`, `I-1766866476983-kmzu`, `I-1766866483395-2bkv`, `I-1766866522708-qiif`, `I-1766866679708-3fio`, `I-1766867495730-urph`, `I-1766969697753-exez`, `I-1766969709975-i7iu`, `I-1766969715831-zbzo`, `I-1766969732336-ptmy`, `I-1767120704519-o3du`, `I-1767120719684-1y95`, `I-1767121369125-flcd`, `I-1767121598448-4hw4`, `I-1767121610499-ogvv`, `I-1767121624861-ila8`, `I-1767121773605-4aae`, `I-1767122288434-8di4`, `I-1767122431453-vh44`, `I-1767122593888-mooc`, `I-1767122824447-e8hk`, `I-1767123055207-j8mq`, `I-1767123880925-p647`, `I-1767123888218-v13f`, `I-1767124979297-crj2`, `I-1767126587835-wr8l`, `I-1767126601585-o0so`, `I-1767126851115-hx0j`, `I-1767126984425-4qmq`, `I-1767127464379-qbfn`, `I-1767127469678-xu6z`, `I-1767127663768-wlql`, `I-1767127757050-i3eg`, `I-1767127883217-0cr3`, `I-1767127889302-nzl3`, `I-1767128043492-lajm`, `I-1767128284710-xnu4`, `I-1767129334152-j5kk`, `I-1767129471239-5osy`, `I-1767129480413-vkdy`, `I-1767129586250-i31k`, `I-1767131649867-z4bo`, `I-1767132339806-kvsc`, `I-1767132714898-kecb`, `I-1767133432112-qdqd`, `I-1767133841043-qnka`, `I-1767133853237-esoj`, `I-1767133855492-uebz`, `I-1767134909280-cax3`, `I-1767140664062-0b2v`, `I-1767140664062-6v4b`, `I-1767140664062-fcth`, `I-1767140664062-ilhl`, `I-1767140664062-l67j`, `I-1767140664062-lits`, `I-1767141035140-ndm7`, ...

### Transactions that exist on both sides but differ

- Total: **94**
- Full per-field diffs are in the JSON report under `reconciliation.transactions.diffs`.
- IDs: `03c3b402-b197-4980-8017-4fe2baa01b0a`, `05bfbae1-ec74-4585-87b5-bbf394a43aee`, `0aa164ea-c98e-4e57-a77c-ce26c35338f3`, `0c6f04d0-8679-4b84-97de-bf1bf00fb677`, `11b04ca4-c647-4628-bf37-6adf03f9aa50`, `166a552f-4a04-4c26-9dcb-f9d284407624`, `17b26c88-63b3-44ac-a3e7-cf17ba60b628`, `17bbfee3-2840-409e-9a68-c7a9ee971439`, `17c85efe-f1f1-4c88-a401-f68e9e31e301`, `180b0a10-f638-46c0-839c-0dd661896f58`, `192c4418-48b2-4dd9-b0a9-652fcb19513a`, `1cbecbb9-8783-40d9-929f-6e8697194902`, `210420be-2b79-4bb2-80db-254e0390ee1f`, `2224113c-aa3d-46c4-ab90-c761cf601a54`, `24689cf9-b604-4ce9-819c-cd4ac187e14f`, `24b3e09f-d7c0-4e11-9e52-bda51d4f8473`, `2759a054-a7fb-461f-bdd1-18e0e8266f7a`, `28919a37-5351-4bc4-a337-8cbdb572ccf4`, `29c76d92-2296-4314-90a4-3918d471e16f`, `2e795394-1f94-4dbc-90f6-bf5c3cbfbcfc`, `31c4873b-82d8-4531-8a34-4897401e6f25`, `356df258-8626-4f6d-bf64-41a0b12c5d0c`, `35c53242-4f66-44f2-9383-f19d3eee92db`, `39dc01a3-d5a6-4e2f-93cd-93a094fe91b9`, `3a230977-b969-4c48-b1a1-2fa97390b73b`, `3e9718ef-83f7-4bdb-b73c-400614dda2d9`, `3f3bb2c6-6679-4dc7-894a-86000261af3e`, `3fa6dc85-632d-43d3-8426-cdd13e116ba9`, `4078240a-e94b-4dc5-aa05-ef677967d026`, `410721b0-2e53-4ff8-b341-8907b944b541`, `46068771-0164-4dd9-a1ef-4c19b2293f4c`, `4aee798c-0094-49dc-a688-4dd4af9edd7a`, `4b58d93e-91a6-4921-8adf-54aba9ed7fea`, `547f672a-13b4-42e9-801a-5448f774f225`, `54e74bfe-28c3-4f0b-8494-e8e582cf5f88`, `5be9957e-382e-406a-8d42-c334a2838277`, `5cafdf4a-3579-4cf4-9d93-5de802255d20`, `5d8e9de8-60ee-49a9-b72c-33acac705f62`, `601e18f7-321a-41ab-86db-dcbf942f7fa8`, `60d7991b-eebc-4cda-be51-4bf8c90a11c4`, `61832c0d-28d5-4ef3-9d5f-be19bd89ca6a`, `64465daa-1e4c-49d4-adfa-06a4d51dc36b`, `64e25cb3-97e4-457d-b6d4-570450a7df4d`, `6a5fd2e9-cfdd-4778-b2dc-2279633f0cda`, `6bf921a7-54c1-4546-a424-1a6c4008169d`, `702b1582-9e05-458c-9ebe-f65d31e5e8ad`, `76288815-29fd-404c-bf2a-4519509ec101`, `76e531ad-1b39-4189-babb-2b145d8a46a3`, `7a158536-dced-4a0d-8258-4be43c7c81cf`, `8728334b-cb99-4b44-a183-f8ec3972b9b9`, `8cfe8892-2505-4cc6-9717-e8ef7e64a983`, `8d51f612-902e-48c4-bf95-338938e2e586`, `948f5e0e-bd00-45a7-83ee-f55f4c04b982`, `96390bc9-d793-40af-905f-c76d82e5e745`, `96b8064d-4b0f-4b97-a259-04a1b4614c54`, `9fab445b-54d8-41e6-8547-786791fd70b1`, `T-1767664011882-gosr`, `T-1767664312931-98tt`, `T-1767664652443-3vj0`, `T-1767664860473-q6nt`, ...

### Notes
- This report is read-only: it only compares the offline export to server rows. No DB writes are performed.
- Timestamp comparisons are normalized by converting both sides to epoch-milliseconds before comparing.
- Numeric tax rate comparisons are normalized to 4 decimal places (matching Postgres numeric text formatting).

