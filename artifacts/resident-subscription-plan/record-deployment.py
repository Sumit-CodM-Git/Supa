exec(open('artifacts/resident-subscription-plan/update-workbook.py').read().split("request={'actionType'")[0])
f=next(x for x in json.loads(Path('artifacts/resident-subscription-plan/deployed-functions.json').read_text()) if x['slug']=='visitor-pass-operations');assert f['status']=='ACTIVE' and f['verify_jwt'] is False
live=json.loads(Path('artifacts/resident-subscription-plan/live-verification.json').read_text());assert live['http_status']==200
status=f"Deployed 2026-11-16: visitor-pass-operations ACTIVE v{f['version']}; existing verify_jwt=false preserved. Authenticated FETCH_RESIDENTS_BY_FLAT live verification HTTP 200; one resident returned subscriptionPlan PREMIUM. No visitor created or notification sent. Other functions and migrations were not deployed in this deployment."
changed={};count=0
for i in range(1,4):
 name=f'xl/worksheets/sheet{i}.xml';text=original[name].decode();root=E.fromstring(text)
 for row in root.findall('.//m:sheetData/m:row',N):
  cells={re.sub(r'\d','',c.get('r')):val(c) for c in row}
  if cells.get('G' if i==1 else 'E')!='visitor-pass-operations':continue
  updates={}
  for col,s in cells.items():
   s=s.replace('This source change is local and has not been deployed or live API tested.',status).replace('Not deployed; no live API test of this field.',status)
   s=s.replace('subscriptionPlan field local only, NOT DEPLOYED.',status)
   if s!=cells[col]:updates[col]=s
  if i==1:updates['Q']=status;updates['U']=updates.get('U',cells['U'])+'\nEvidence: artifacts/resident-subscription-plan/deployed-functions.json; live-verification.json.'
  else:updates['N']='Local plan and visitor creation regression tests passed; live authenticated resident lookup HTTP 200 with subscriptionPlan PREMIUM.';updates['O']=status;updates['T']=updates.get('T',cells['T'])+'\nEvidence: artifacts/resident-subscription-plan/deployed-functions.json; live-verification.json.'
  for col,s in updates.items():
   assert len(s)<=32767
   ref=col+row.get('r');m=re.search(rf'<c\b[^>]*\br="{ref}"[^>]*(?:/>|>.*?</c>)',text,re.S);assert m
   style=re.search(r'\bs="([^"]+)"',m.group().split('>',1)[0]);new=f'<c r="{ref}"'+(f' s="{style.group(1)}"' if style else '')+' t="inlineStr"><is><t xml:space="preserve">'+escape(s)+'</t></is></c>'
   text=text[:m.start()]+new+text[m.end():]
  count+=1
 if text.encode()!=original[name]:changed[name]=text.encode()
assert count==2
out=P.with_suffix('.tmp.xlsx')
with zipfile.ZipFile(out,'w') as z:
 for e in entries:z.writestr(e,changed.get(e.filename,original[e.filename]))
with zipfile.ZipFile(out) as z:
 assert z.testzip() is None
 for name,b in original.items():
  if name not in changed:assert z.read(name)==b
  if name.endswith('.xml'):E.fromstring(z.read(name))
out.replace(P)
print(status);print('Updated both endpoint documentation rows; workbook integrity verified.')
