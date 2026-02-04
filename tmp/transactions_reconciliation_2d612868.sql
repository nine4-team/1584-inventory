with local_raw as (
  select *
  from jsonb_to_recordset('[{"transaction_id":"04368041-4d1a-4054-9ad9-185e4587ab10","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-15","source":"Arhaus","transaction_type":"Purchase","payment_method":"Client Card","amount":"5087.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"4625.00","needs_review":true,"sum_item_purchase_prices":"1250","item_ids":["I-1766004939000-309f","I-1766004939000-82f4","I-1766004939000-8a4b","I-1766004939000-9f97","I-1766004939000-a34f","I-1766004939000-a9cc","I-1766004939000-d213","I-1766004939000-ede7"]},{"transaction_id":"23488466-31f5-4e43-8a1c-326b4dc1fd79","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-05","source":"West Elm","transaction_type":"Purchase","payment_method":"Client Card","amount":"2530.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"2300.00","needs_review":true,"sum_item_purchase_prices":"0","item_ids":["I-1766004712000-17e2","I-1766004712000-3585","I-1766004712000-5fcd","I-1766004712000-6e1e","I-1766004712000-7c0b","I-1766004712000-8810","I-1766004712000-c521","I-1766004712000-c760","I-1766004712000-cf1f","I-1766004712000-ef9c"]},{"transaction_id":"471dd0bb-eeb4-4d27-acb0-952ec560e147","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-17","source":"Home Depot","transaction_type":"Purchase","payment_method":"Client Card","amount":"4180.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"3800.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"4888b2ee-864a-46c2-8994-3db6e3129131","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-27","source":"Gas","transaction_type":"Purchase","payment_method":"Design Business Card","amount":"935.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":"Design Business Owes Client","trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"850.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"49bcc55f-2897-4539-98f8-ae3e77ccb0ab","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-19","source":"Storage Facility","transaction_type":"Purchase","payment_method":"Client Card","amount":"935.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"850.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"4ee2b42c-113a-46df-afb7-88cd65eeb503","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-17","source":"Storage Facility","transaction_type":"Purchase","payment_method":"Client Card","amount":"3080.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"2800.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"4f70495c-e00b-46b7-afbf-fc5cf7c560e8","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-02","source":"Crate & Barrel","transaction_type":"Purchase","payment_method":"Design Business Card","amount":"11583.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":"Client Owes Design Business","trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"10530.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766004682000-157a","I-1766004682000-202f","I-1766004682000-4160","I-1766004682000-54df","I-1766004682000-8467","I-1766004682000-a7be","I-1766004682000-ccfd","I-1766004682000-d3e2","I-1766004682000-eff5","I-1766004682000-f861"]},{"transaction_id":"547f393b-1793-4cfc-adc8-ac5fa1c2306b","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-15","source":"Amazon","transaction_type":"Purchase","payment_method":"Client Card","amount":"1380.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"1255.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005316000-018f","I-1766005316000-2150","I-1766005316000-7b2e","I-1766005316000-8027","I-1766005316000-9a78","I-1766005316000-9af4","I-1766005316000-a7aa","I-1766005316000-ba0a","I-1766005316000-d9fc","I-1766005316000-dd80"]},{"transaction_id":"5d64f080-5b5e-42e6-91a3-90f7ddcce3bf","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-09","source":"Wayfair","transaction_type":"Purchase","payment_method":"Client Card","amount":"9212.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"8375.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005294000-1828","I-1766005294000-188e","I-1766005294000-2228","I-1766005294000-4ac7","I-1766005294000-6761","I-1766005294000-6c1a","I-1766005294000-a668","I-1766005294000-cb24","I-1766005294000-cfe3","I-1766005294000-f657"]},{"transaction_id":"60e7cc5c-4603-4056-b5a8-f62cf9799180","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-19","source":"Living Spaces","transaction_type":"Purchase","payment_method":"Client Card","amount":"2524.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"2295.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766004956000-7a0d","I-1766004956000-86f4","I-1766004956000-b83e","I-1766004956000-bca1","I-1766004956000-cd1a","I-1766004956000-d2fe","I-1766004956000-e97e","I-1766004956000-ea02"]},{"transaction_id":"64265762-c2d8-44c8-8c06-0301f0c6e502","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-25","source":"Gas","transaction_type":"Purchase","payment_method":"Design Business Card","amount":"1815.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":"Design Business Owes Client","trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"1650.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"68322e81-e006-463d-afca-d4b514221479","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2026-01-07","source":"Homegoods","transaction_type":"Purchase","payment_method":"Design Business","amount":"1000","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"664","item_ids":["I-1767139637044-ysp6","I-1767159744325-4ay5"]},{"transaction_id":"6a2e93b7-af52-4434-8df4-f72489a56773","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-29","source":"Various","transaction_type":"Purchase","payment_method":"Client Card","amount":"6754.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"6140.00","needs_review":true,"sum_item_purchase_prices":"0","item_ids":["I-1766005344000-2f12","I-1766005344000-3748","I-1766005344000-3f10","I-1766005344000-512b","I-1766005344000-8761","I-1766005344000-9fd7","I-1766005344000-b156","I-1766005344000-c1f3"]},{"transaction_id":"77fd5a3f-8c9d-4dcf-8561-5b60f2f60fce","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-27","source":"Property Management Co","transaction_type":"Purchase","payment_method":"Client Card","amount":"6380.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"5800.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"867a5582-1421-4c9a-9aa4-9c60048336bf","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-22","source":"Arhaus","transaction_type":"Purchase","payment_method":"Client Card","amount":"4009.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"3645.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005329000-193a","I-1766005329000-3b09","I-1766005329000-3e91","I-1766005329000-6742","I-1766005329000-72d6","I-1766005329000-9afe","I-1766005329000-a24c","I-1766005329000-ffda"]},{"transaction_id":"86c0f78c-9d2a-4cab-9c87-5db6bf558635","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-22","source":"Local Installer","transaction_type":"Purchase","payment_method":"Client Card","amount":"3520.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"3200.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"8fa8670a-8e00-4044-9930-e47b3f69b34d","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2025-11-22","source":"Target","transaction_type":"Purchase","payment_method":"Client Card","amount":"678.70","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"testicles!","status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":"10","subtotal":null,"needs_review":true,"sum_item_purchase_prices":"0","item_ids":["I-1766005216000-0fb4","I-1766005216000-2a12","I-1766005216000-379d","I-1766005216000-3a62","I-1766005216000-65aa","I-1766005216000-871f","I-1766005216000-8c34","I-1766005216000-d553","I-1766005216000-da3a","I-1766005216000-eb3a"]},{"transaction_id":"9689e160-6232-48da-9bc4-1693201012ea","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2025-11-10","source":"Homegoods","transaction_type":"Purchase","payment_method":"Design Business","amount":"0.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Test transaction for project items","status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":"Other","tax_rate_pct":"10","subtotal":"1525.00","needs_review":true,"sum_item_purchase_prices":"-2821.31","item_ids":[]},{"transaction_id":"99ea2cd8-6b89-4fa2-851d-a4e3aedc4833","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2024-07-09","source":"Homegoods","transaction_type":"Purchase","payment_method":"Client Card","amount":"290","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":"Other","tax_rate_pct":"5.4545","subtotal":"275","needs_review":true,"sum_item_purchase_prices":"275","item_ids":["I-1766538011710-c68c"]},{"transaction_id":"INV_PURCHASE_2115f472-03a1-4872-aa20-881a24d36389","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2026-01-21","source":"Inventory","transaction_type":"Purchase","payment_method":"Pending","amount":"5190.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Transaction for items purchased from inventory","status":"pending","reimbursement_type":"Client Owes Design Business","trigger_event":"Inventory allocation","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"3090","item_ids":["I-1766005262000-a4b5","I-1766005262000-b754","I-1766005344000-9fd7","I-1768699268645-4gpv"]},{"transaction_id":"INV_PURCHASE_60734ca8-8f0d-4f96-8cab-f507fa0829e5","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2026-01-22","source":"Inventory","transaction_type":"Purchase","payment_method":"Pending","amount":"3958.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Transaction for items purchased from inventory","status":"pending","reimbursement_type":"Client Owes Design Business","trigger_event":"Inventory allocation","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"3958","item_ids":["I-1766005226000-3414","I-1766005344000-9fd7","I-1768699268645-4gpv","I-1769067831859-eu2x","I-1769071093842-z3gx"]},{"transaction_id":"INV_PURCHASE_6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2026-01-22","source":"Inventory","transaction_type":"Purchase","payment_method":"Pending","amount":"1120.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Transaction for items purchased from inventory","status":"pending","reimbursement_type":"Client Owes Design Business","trigger_event":"Inventory allocation","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"1120","item_ids":["I-1766005226000-fd94","I-1768715919220-qqi5","I-1768716030035-vcmk","I-1768716030306-rc38","I-1768716030587-cirp","I-1769071094793-yl4v"]},{"transaction_id":"INV_SALE_2115f472-03a1-4872-aa20-881a24d36389","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2026-01-22","source":"Hawaii Apartment","transaction_type":"Sale","payment_method":"Pending","amount":"1858.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Transaction for items purchased from project and moved to business inventory","status":"pending","reimbursement_type":"Design Business Owes Client","trigger_event":"Inventory sale","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005226000-3414","I-1768715919220-qqi5","I-1769067831859-eu2x","I-1769071093842-z3gx"]},{"transaction_id":"INV_SALE_60734ca8-8f0d-4f96-8cab-f507fa0829e5","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2026-01-22","source":"Desert Escape","transaction_type":"Sale","payment_method":"Pending","amount":"0.00","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":"Transaction for items purchased from project and moved to business inventory","status":"pending","reimbursement_type":"Design Business Owes Client","trigger_event":"Inventory sale","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005226000-fd94","I-1766005262000-a4b5","I-1766005262000-b754","I-1766005344000-9fd7","I-1768715917748-syie","I-1769071094793-yl4v"]},{"transaction_id":"INV_SALE_6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2025-12-29","source":"Brianhead Cabin","transaction_type":"To Inventory","payment_method":"Pending","amount":"212.03","category_id":null,"notes":"Transaction for items purchased from project and moved to business inventory","status":"pending","reimbursement_type":"Design Business Owes Client","trigger_event":"Inventory sale","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":false,"sum_item_purchase_prices":"424.06","item_ids":["I-1768705183733-5w08"]},{"transaction_id":"T-1768514173116-d9b7","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2026-01-15","source":"Homegoods","transaction_type":"Purchase","payment_method":"","amount":"699","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"a03488ca-3857-406a-a120-0b271b44662e","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-05","source":"Various","transaction_type":"Purchase","payment_method":"Client Card","amount":"2678.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"2435.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005286000-24af","I-1766005286000-646d","I-1766005286000-7778","I-1766005286000-7cee","I-1766005286000-a1ac","I-1766005286000-b08a","I-1766005286000-ba7e","I-1766005286000-bc77"]},{"transaction_id":"a5e1e039-bafc-46d3-b0fc-f512a36adeb4","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-25","source":"Amazon","transaction_type":"Purchase","payment_method":"Client Card","amount":"1196.80","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"1088.00","needs_review":true,"sum_item_purchase_prices":"-915","item_ids":["I-1766005226000-2451","I-1766005226000-3414","I-1766005226000-71eb","I-1766005226000-9b0a","I-1766005226000-c818","I-1766005226000-ca56","I-1766005226000-e803","I-1766005226000-f330","I-1766005226000-fb35","I-1769067831859-eu2x"]},{"transaction_id":"ab00f86b-69dc-43bb-87a1-aa477c32f59f","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":null,"transaction_date":"2025-11-10","source":"Homegoods","transaction_type":"Purchase","payment_method":"Client Card","amount":"2090.00","category_id":null,"notes":"Test transaction for business inventory","status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"1900.00","needs_review":true,"sum_item_purchase_prices":"3350","item_ids":["I-1768699268645-4gpv","I-ff00cdf3-55c7-421b-981b-e97d172b5628"]},{"transaction_id":"ab6c665f-1d4d-4d58-9ab1-5bf46c9cd97d","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":null,"transaction_date":"2026-01-15","source":"Homegoods","transaction_type":"Purchase","payment_method":"","amount":"668","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"abd738fc-9741-4c70-bbd9-6da1c6d6f93c","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":null,"transaction_date":"2026-01-25","source":"Wayfair","transaction_type":"Purchase","payment_method":"","amount":"1","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"pending","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"0","item_ids":["I-1769545630694-v9xf","I-1769970089754-4jag","I-1769970612362-yl4d","I-1769970853281-lcm3"]},{"transaction_id":"bfe4dd26-eec5-4e61-8317-34b37c710ec7","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"6bb65110-90bc-42ea-a5fa-1b7bfd5d7d70","transaction_date":"2026-01-07","source":"Amazon","transaction_type":"Purchase","payment_method":"Client Card","amount":"2","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"5207.84","item_ids":["I-1767841684249-1sxc","I-1768700509398-tb9s","I-1768700510101-p35a","I-1768715684810-qanh","I-1768715803429-fa0h","I-1768715815147-ak3p","I-1768715815872-fvbu"]},{"transaction_id":"c1f35dbe-2d93-4af6-a82e-aede67c86454","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-12","source":"Crate & Barrel","transaction_type":"Purchase","payment_method":"Client Card","amount":"7084.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"6440.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005302000-2e17","I-1766005302000-41ad","I-1766005302000-8d20","I-1766005302000-97b3","I-1766005302000-9896","I-1766005302000-c03d","I-1766005302000-c820","I-1766005302000-d290"]},{"transaction_id":"d35319ef-df19-4129-80c6-b900804a953f","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2025-11-09","source":"Wayfair","transaction_type":"Purchase","payment_method":"Client Card","amount":"5302.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"4820.00","needs_review":true,"sum_item_purchase_prices":"0","item_ids":["I-1766004928000-786e","I-1766004928000-7888","I-1766004928000-7ae5","I-1766004928000-7f44","I-1766004928000-a144","I-1766004928000-ced6","I-1766004928000-f869"]},{"transaction_id":"df0d61f0-d5c3-4541-88fe-8078e631f344","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-19","source":"West Elm","transaction_type":"Purchase","payment_method":"Client Card","amount":"5368.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"4880.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005322000-476b","I-1766005322000-4984","I-1766005322000-613a","I-1766005322000-74d8","I-1766005322000-9278","I-1766005322000-ad62"]},{"transaction_id":"f227f1ce-622e-470c-b47e-31e749ccc6fa","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"2115f472-03a1-4872-aa20-881a24d36389","transaction_date":"2026-01-22","source":"Homegoods","transaction_type":"Return","payment_method":"","amount":"10","category_id":"6e5a3c0f-2a24-42ea-8e2f-8ab833166e62","notes":null,"status":"completed","reimbursement_type":null,"trigger_event":"Manual","tax_rate_preset":null,"tax_rate_pct":null,"subtotal":null,"needs_review":true,"sum_item_purchase_prices":"160","item_ids":["I-1766005226000-71eb","I-1766005226000-9b0a"]},{"transaction_id":"f83887f5-e563-4e50-afa7-b8db72a36cab","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-25","source":"Target","transaction_type":"Purchase","payment_method":"Client Card","amount":"727.10","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"661.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005336000-29cc","I-1766005336000-6fb8","I-1766005336000-b23d","I-1766005336000-d686","I-1766005336000-e666","I-1766005336000-eb84","I-1766005336000-ec3b","I-1766005336000-edb2"]},{"transaction_id":"f855ed8a-ab57-40e7-bd7c-a1e544a85969","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-22","source":"Local Installer","transaction_type":"Purchase","payment_method":"Client Card","amount":"4400.00","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"4000.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":[]},{"transaction_id":"faefac18-92ea-4378-8d7c-f721dd6a9fae","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-11-02","source":"Homegoods","transaction_type":"Purchase","payment_method":"Client Card","amount":"3349.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":null,"trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"3045.00","needs_review":false,"sum_item_purchase_prices":"0","item_ids":["I-1766005276000-1752","I-1766005276000-1bc7","I-1766005276000-5b5f","I-1766005276000-74e0","I-1766005276000-7a82","I-1766005276000-7b56","I-1766005276000-7c6c","I-1766005276000-927a","I-1766005276000-98f9","I-1766005276000-c669"]},{"transaction_id":"fc69cb2e-72ea-4ac3-9796-52a42cada62f","account_id":"2d612868-852e-4a80-9d02-9d10383898d4","project_id":"60734ca8-8f0d-4f96-8cab-f507fa0829e5","transaction_date":"2025-10-28","source":"Pottery Barn","transaction_type":"Purchase","payment_method":"Design Business Card","amount":"15757.50","category_id":null,"notes":null,"status":"completed","reimbursement_type":"Client Owes Design Business","trigger_event":null,"tax_rate_preset":null,"tax_rate_pct":"10","subtotal":"14325.00","needs_review":false,"sum_item_purchase_prices":"-620","item_ids":["I-1766005262000-14be","I-1766005262000-180b","I-1766005262000-4900","I-1766005262000-4cb7","I-1766005262000-78ce","I-1766005262000-7fdc","I-1766005262000-9908","I-1766005262000-a082","I-1766005262000-a4b5","I-1766005262000-a59b","I-1766005262000-b754","I-1766005262000-c9fc"]}]') as l(
    transaction_id text,
    account_id uuid,
    project_id uuid,
    transaction_date text,
    source text,
    transaction_type text,
    payment_method text,
    amount text,
    category_id uuid,
    notes text,
    status text,
    reimbursement_type text,
    trigger_event text,
    tax_rate_preset text,
    tax_rate_pct text,
    subtotal text,
    needs_review boolean,
    sum_item_purchase_prices text,
    item_ids jsonb
  )
),
local_norm as (
  select
    transaction_id,
    account_id,
    project_id,
    nullif(transaction_date,'')::date as transaction_date,
    coalesce(nullif(source,''),'') as source,
    coalesce(nullif(transaction_type,''),'') as transaction_type,
    coalesce(nullif(payment_method,''),'') as payment_method,
    nullif(amount,'')::numeric as amount_num,
    category_id,
    coalesce(nullif(notes,''),'') as notes,
    coalesce(nullif(status,''),'') as status,
    coalesce(nullif(reimbursement_type,''),'') as reimbursement_type,
    coalesce(nullif(trigger_event,''),'') as trigger_event,
    coalesce(nullif(tax_rate_preset,''),'') as tax_rate_preset,
    nullif(tax_rate_pct,'')::numeric as tax_rate_pct_num,
    nullif(subtotal,'')::numeric as subtotal_num,
    needs_review,
    nullif(sum_item_purchase_prices,'')::numeric as sum_item_purchase_prices_num,
    (
      select coalesce(array_agg(distinct v order by v), array[]::text[])
      from jsonb_array_elements_text(coalesce(item_ids,'[]'::jsonb)) as e(v)
      where v like 'I-%'
    ) as item_ids_norm
  from local_raw
),
server_raw as (
  select
    transaction_id,
    account_id,
    project_id,
    transaction_date,
    source,
    transaction_type,
    payment_method,
    amount,
    category_id,
    notes,
    status,
    reimbursement_type,
    trigger_event,
    tax_rate_preset,
    tax_rate_pct,
    subtotal,
    needs_review,
    sum_item_purchase_prices,
    item_ids,
    version,
    updated_at as last_updated,
    created_at,
    created_by
  from public.transactions
  where account_id = '2d612868-852e-4a80-9d02-9d10383898d4'
),
server_norm as (
  select
    transaction_id,
    account_id,
    project_id,
    transaction_date,
    coalesce(nullif(source,''),'') as source,
    coalesce(nullif(transaction_type,''),'') as transaction_type,
    coalesce(nullif(payment_method,''),'') as payment_method,
    nullif(amount,'')::numeric as amount_num,
    category_id,
    coalesce(nullif(notes,''),'') as notes,
    coalesce(nullif(status,''),'') as status,
    coalesce(nullif(reimbursement_type,''),'') as reimbursement_type,
    coalesce(nullif(trigger_event,''),'') as trigger_event,
    coalesce(nullif(tax_rate_preset,''),'') as tax_rate_preset,
    tax_rate_pct::numeric as tax_rate_pct_num,
    nullif(subtotal,'')::numeric as subtotal_num,
    needs_review,
    sum_item_purchase_prices::numeric as sum_item_purchase_prices_num,
    (
      select coalesce(array_agg(distinct v order by v), array[]::text[])
      from unnest(coalesce(item_ids, array[]::text[])) as u(v)
      where v like 'I-%'
    ) as item_ids_norm
  from server_raw
),
local_ids as (select transaction_id from local_norm),
server_ids as (select transaction_id from server_norm),
local_only as (
  select transaction_id from local_ids
  except
  select transaction_id from server_ids
),
server_only as (
  select transaction_id from server_ids
  except
  select transaction_id from local_ids
),
paired as (
  select l.transaction_id, l, s
  from local_norm l
  join server_norm s using (transaction_id)
),
scalar_diffs as (
  select
    transaction_id,
    jsonb_strip_nulls(jsonb_build_object(
      'projectId', case when (p.l).project_id is distinct from (p.s).project_id then jsonb_build_object('local', (p.l).project_id, 'server', (p.s).project_id) end,
      'transactionDate', case when (p.l).transaction_date is distinct from (p.s).transaction_date then jsonb_build_object('local', (p.l).transaction_date, 'server', (p.s).transaction_date) end,
      'source', case when (p.l).source is distinct from (p.s).source then jsonb_build_object('local', (p.l).source, 'server', (p.s).source) end,
      'transactionType', case when (p.l).transaction_type is distinct from (p.s).transaction_type then jsonb_build_object('local', (p.l).transaction_type, 'server', (p.s).transaction_type) end,
      'paymentMethod', case when (p.l).payment_method is distinct from (p.s).payment_method then jsonb_build_object('local', (p.l).payment_method, 'server', (p.s).payment_method) end,
      'amount', case when (p.l).amount_num is distinct from (p.s).amount_num then jsonb_build_object('local', (p.l).amount_num, 'server', (p.s).amount_num) end,
      'categoryId', case when (p.l).category_id is distinct from (p.s).category_id then jsonb_build_object('local', (p.l).category_id, 'server', (p.s).category_id) end,
      'notes', case when (p.l).notes is distinct from (p.s).notes then jsonb_build_object('local', (p.l).notes, 'server', (p.s).notes) end,
      'status', case when (p.l).status is distinct from (p.s).status then jsonb_build_object('local', (p.l).status, 'server', (p.s).status) end,
      'reimbursementType', case when (p.l).reimbursement_type is distinct from (p.s).reimbursement_type then jsonb_build_object('local', (p.l).reimbursement_type, 'server', (p.s).reimbursement_type) end,
      'triggerEvent', case when (p.l).trigger_event is distinct from (p.s).trigger_event then jsonb_build_object('local', (p.l).trigger_event, 'server', (p.s).trigger_event) end,
      'taxRatePreset', case when (p.l).tax_rate_preset is distinct from (p.s).tax_rate_preset then jsonb_build_object('local', (p.l).tax_rate_preset, 'server', (p.s).tax_rate_preset) end,
      'taxRatePct', case when (p.l).tax_rate_pct_num is distinct from (p.s).tax_rate_pct_num then jsonb_build_object('local', (p.l).tax_rate_pct_num, 'server', (p.s).tax_rate_pct_num) end,
      'subtotal', case when (p.l).subtotal_num is distinct from (p.s).subtotal_num then jsonb_build_object('local', (p.l).subtotal_num, 'server', (p.s).subtotal_num) end,
      'needsReview', case when (p.l).needs_review is distinct from (p.s).needs_review then jsonb_build_object('local', (p.l).needs_review, 'server', (p.s).needs_review) end,
      'sumItemPurchasePrices', case when (p.l).sum_item_purchase_prices_num is distinct from (p.s).sum_item_purchase_prices_num then jsonb_build_object('local', (p.l).sum_item_purchase_prices_num, 'server', (p.s).sum_item_purchase_prices_num) end
    )) as diffs
  from paired p
),
scalar_diff_filtered as (
  select transaction_id, diffs
  from scalar_diffs
  where diffs <> '{}'::jsonb
),
item_membership_diffs as (
  select
    transaction_id,
    (
      select coalesce(array_agg(v order by v), array[]::text[])
      from (
        select unnest((p.l).item_ids_norm) as v
        except
        select unnest((p.s).item_ids_norm) as v
      ) q
    ) as missing_on_server,
    (
      select coalesce(array_agg(v order by v), array[]::text[])
      from (
        select unnest((p.s).item_ids_norm) as v
        except
        select unnest((p.l).item_ids_norm) as v
      ) q
    ) as extra_on_server
  from paired p
),
item_membership_diff_filtered as (
  select transaction_id, missing_on_server, extra_on_server
  from item_membership_diffs
  where array_length(missing_on_server, 1) > 0 or array_length(extra_on_server, 1) > 0
)
select jsonb_build_object(
  'generatedAt', now(),
  'accountId', '2d612868-852e-4a80-9d02-9d10383898d4',
  'dryRun', true,
  'export', jsonb_build_object(
    'exportedAt', '2026-02-03T23:21:29.386Z',
    'source', 'dev_docs/actively_implementing/ledger-offline-export-2d612868-852e-4a80-9d02-9d10383898d4-2026-02-03T23_21_29.386Z.json'
  ),
  'offlineSnapshot', jsonb_build_object(
    'localTransactions', (select count(*) from local_norm)
  ),
  'serverSnapshot', jsonb_build_object(
    'serverTransactions', (select count(*) from server_norm),
    'query', 'SELECT transaction_id, ... FROM public.transactions WHERE account_id = <accountId> AND transaction_id = ANY(<localTransactionIds>)'
  ),
  'reconciliation', jsonb_build_object(
    'localOnlyTransactions', (select coalesce(jsonb_agg(transaction_id order by transaction_id), '[]'::jsonb) from local_only),
    'serverOnlyTransactions', (select coalesce(jsonb_agg(transaction_id order by transaction_id), '[]'::jsonb) from server_only),
    'scalarFieldDiffs', (select coalesce(jsonb_agg(jsonb_build_object('transactionId', transaction_id, 'diffs', diffs) order by transaction_id), '[]'::jsonb) from scalar_diff_filtered),
    'itemIdsMembershipDiffs', (select coalesce(jsonb_agg(jsonb_build_object('transactionId', transaction_id, 'missingOnServer', missing_on_server, 'extraOnServer', extra_on_server) order by transaction_id), '[]'::jsonb) from item_membership_diff_filtered)
  ),
  'counts', jsonb_build_object(
    'localOnlyTransactions', (select count(*) from local_only),
    'serverOnlyTransactions', (select count(*) from server_only),
    'transactionsWithScalarDiffs', (select count(*) from scalar_diff_filtered),
    'transactionsWithItemIdsMembershipDiffs', (select count(*) from item_membership_diff_filtered)
  ),
  'normalization', jsonb_build_object(
    'nullVsEmptyString', 'coalesced to empty string for text fields in comparisons',
    'numeric', 'compared numeric fields as numeric (amount, taxRatePct, subtotal, sumItemPurchasePrices)',
    'itemIds', 'treated arrays as sets (distinct + order-insensitive), filtered to canonical I-... ids only'
  )
) as report;