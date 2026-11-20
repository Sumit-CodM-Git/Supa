from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
x=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())['get-visitors']
request=x['requestCell'].replace('"status": "Example text"','"status": "all"').replace('["Example text"]','["all"]').replace('"hostedBy": "Example text"','"hostedBy": ""').replace('"search": "Example text"','"search": ""')
response=x['responseCell'].replace('"role": "resident"','"role": "visitor"').replace('"status": "active"','"status": "pending"').replace('"purpose": "Example details"','"purpose": "delivery"').replace('"checkIn": "Example text"','"checkIn": null').replace('"checkOut": "Example text"','"checkOut": null').replace('"currentlyInside": "Example text"','"currentlyInside": 0').replace('"currentlyOutside": "Example text"','"currentlyOutside": 0').replace('"totalVisitedToday": 1','"totalVisitedToday": 0')
response+='\n\n// ORDERING: visitors are ordered by createdAt descending (newest addition first), irrespective of checkIn.\n// Pending visitors, deliveries and guests participate in the same ordering.\n// Equal creation timestamps use non_society_user_id descending; null creation dates come last.\n// Filtering preserves this order; pagination is applied afterwards.\n// JSONC examples: remove // comments before sending JSON.'
with zipfile.ZipFile(book) as z:
 data={i.filename:z.read(i.filename) for i in z.infolist()};changed={};updated=[]
 for s in range(1,4):
  part=f'xl/worksheets/sheet{s}.xml';xml=data[part].decode()
  for row in E.fromstring(data[part]).findall('m:sheetData/m:row',ns):
   c={re.match('[A-Z]+',v.get('r')).group():''.join(v.itertext()) for v in row.findall('m:c',ns)}
   if c.get('I' if s==1 else 'G','').strip('/')!='get-visitors':continue
   number=row.get('r');desc='K' if s==1 else 'I'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Admin visitor log ordering: newest additions first by created_at descending, nulls last, then non_society_user_id descending for stable ties. Includes visitors/deliveries/guests, including pending and scheduled check-ins. Filtering and pagination retain this order; request/response fields are unchanged.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/get-visitors/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions/get-visitors/index.ts').read_bytes()).hexdigest()+'\nVerified: supabase/tests/admin-visitor-order.mjs (mocked API regression tests; live UI not tested).'}
   for col,value in values.items():
    assert len(value.encode('utf-16-le'))//2<=32767
    ref=col+number;m=re.search(r'<c\b[^>]*\br="'+ref+r'"[^>]*(?:/>|>.*?</c>)',xml,re.S);assert m
    style=re.search(r'\bs="([^"]+)"',m.group());style=style.group(1) if style else '46'
    xml=xml[:m.start()]+f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>'+xml[m.end():]
   updated.append((s,number))
  if xml.encode()!=data[part]:changed[part]=xml.encode();E.fromstring(changed[part])
 assert updated
 temp=book.with_suffix('.pending.xlsx')
 with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(info,changed.get(info.filename,data[info.filename]))
with zipfile.ZipFile(temp) as out:
 assert out.testzip() is None
 for part,old in data.items():
  if part.endswith('.xml'):E.fromstring(out.read(part))
  if part not in changed:assert out.read(part)==old
 temp.replace(book)
print('Workbook validated, updated get-visitors rows:',updated)
