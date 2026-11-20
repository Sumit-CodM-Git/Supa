from pathlib import Path
# Reuse the JSONC/cell helpers without executing the earlier one-time workbook update.
helpers=Path('artifacts/visitor-plan-rules/update-workbook.py').read_text().split("visitor={",1)[0]
exec(helpers)
oldmatrix='Visitor plan matrix: PREMIUM visitor access and OTP; GROWTH and STARTER visitor access without OTP; FREE no visitor access, visitor tab or visitor dashboard card. Plan decisions use the target resident flat entitlements, including billing expiry fallback, not the security guard plan. Other feature categories are outside this visitor change.'
newmatrix='Visitor plan matrix: PREMIUM has visitor tab/card and OTP; GROWTH and STARTER have visitor tab/card without OTP; FREE has no visitor tab/card or OTP. Security creation and resident approval remain enabled for Free as before; tab visibility is separate from approval. Features: VISITOR_APPROVAL, VISITOR_OTP, VISITOR_TAB, VISITOR_DASHBOARD_CARD. Target resident flat entitlements determine the flow, not the guard plan. This change covers visitor rules only.'
changed={};touched=set();matches=[]
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',NS):
  cells={re.sub(r'\d','',c.get('r')):value(c) for c in row};ep=cells.get('G' if i==1 else 'E')
  if ep not in ['security-gate-console','visitor-pass-operations','resident-visitor','get-dashboard','send-notification']:continue
  cols=['K','M','T','U'] if i==1 else ['I','K','R','T'];updates={}
  for col in cols:
   s=cells[col].replace(oldmatrix,newmatrix)
   if col==('T' if i==1 else 'R'):
    if ep in ['security-gate-console','visitor-pass-operations']:
     s=s.replace('JSONC Free plan denial (HTTP 402):','JSONC approval-feature-disabled denial (HTTP 402; not the default Free setting):')
     s=s.replace("The selected resident's plan does not include visitor access.","The selected resident's plan does not include visitor approval.")
     s+='\nFree also uses otpRequired=false and nextStep=COMPLETED for security-created visitors; only its resident tab/card are disabled.'
    if ep=='resident-visitor':
     s=s.replace("The selected resident's plan does not include visitor access.","The selected resident's plan does not include the visitor tab.")
     s=s.replace('"requiredFeature": "VISITOR_APPROVAL"','"requiredFeature": "VISITOR_TAB"')
    if ep=='send-notification':
     s=s.replace('JSONC Free-plan suppressed delivery (HTTP 200):','JSONC approval-feature-disabled delivery (HTTP 200; not the default Free setting):')
     s=s.replace('Starter/Growth unverified phone state does not suppress delivery.','Free/Starter/Growth unverified phone state does not suppress delivery. Free tab/card visibility does not disable gate approval notifications.')
   if col==('U' if i==1 else 'T'):
    s='supabase/functions/'+ep+'/index.ts\nSource SHA-256: '+sha('supabase/functions/'+ep+'/index.ts')+'\nHelper SHA-256: '+sha('supabase/functions/_shared/visitor-plan.ts')+'\nMigration: supabase/migrations/20261116110000_plan_aware_visitors.sql\nVerified locally: four-plan security creation/OTP matrix, dashboard visibility, plan-aware delivery, and PostgreSQL/PGlite creation/verification/no-duplicate/direct-writer/away tests. Free approval retained independently of tab/card; no fake OTP verification. No deployment or live device test. Evidence: artifacts/visitor-plan-rules/database-test.json.'
   updates[col]=s
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():];touched.add((i,ref))
  for doccol in (['M','T'] if i==1 else ['K','R']):
   for start,end,obj,heading in blocks(updates.get(doccol,cells[doccol])):json.loads(json.dumps(obj))
  matches.append((i,row.get('r'),ep))
 if text.encode()!=original[name]:changed[name]=text.encode()
assert len(matches)==7
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';before={c.get('r'):value(c) for c in E.fromstring(original[name]).findall('.//m:sheetData/m:row/m:c',NS)}
 for c in E.fromstring(changed.get(name,original[name])).findall('.//m:sheetData/m:row/m:c',NS):
  assert len(value(c))<=32767
  if (i,c.get('r')) not in touched:assert value(c)==before.get(c.get('r'),'')
tmp=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(tmp,'w') as z:
 for entry in entries:z.writestr(entry,changed.get(entry.filename,original[entry.filename]))
with zipfile.ZipFile(tmp) as z:
 assert z.testzip() is None
 for name,before in original.items():
  if name not in changed:assert z.read(name)==before
  if name.endswith('.xml'):E.fromstring(z.read(name))
tmp.replace(P)
print('Final visitor plan documentation validated in all seven matching rows; unrelated cells and worksheets preserved.')
