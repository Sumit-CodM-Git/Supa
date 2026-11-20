-- Expand allowed flat types and refresh existing labels/order without changing keys.
INSERT INTO public."SSP_Picklist_Config"
  (table_name, field_name, language, value, label, is_active, sort_order)
VALUES
  ('SSP_Flat_Type','flat_type','en','studio','Studio',true,1),
  ('SSP_Flat_Type','flat_type','en','1_rk','1 RK',true,2),
  ('SSP_Flat_Type','flat_type','en','1_bhk','1 BHK',true,3),
  ('SSP_Flat_Type','flat_type','en','1.5_bhk','1.5 BHK',true,4),
  ('SSP_Flat_Type','flat_type','en','2_bhk','2 BHK',true,5),
  ('SSP_Flat_Type','flat_type','en','2.5_bhk','2.5 BHK',true,6),
  ('SSP_Flat_Type','flat_type','en','3_bhk','3 BHK',true,7),
  ('SSP_Flat_Type','flat_type','en','3.5_bhk','3.5 BHK',true,8),
  ('SSP_Flat_Type','flat_type','en','4_bhk','4 BHK',true,9),
  ('SSP_Flat_Type','flat_type','en','5_bhk','5 BHK',true,10),
  ('SSP_Flat_Type','flat_type','en','6_bhk','6 BHK',true,11),
  ('SSP_Flat_Type','flat_type','en','duplex','Duplex',true,12),
  ('SSP_Flat_Type','flat_type','en','triplex','Triplex',true,13),
  ('SSP_Flat_Type','flat_type','en','penthouse','Penthouse',true,14)
ON CONFLICT (table_name, field_name, language, value)
DO UPDATE SET label=EXCLUDED.label, is_active=EXCLUDED.is_active, sort_order=EXCLUDED.sort_order
RETURNING value,label,is_active,sort_order;
