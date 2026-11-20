from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
examples=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())
names={'get-visitors','my-visitors','resident-visitor','resident-visitor-logs','security-gate-console','visitor-pass-operations'}
with zipfile.ZipFile(book) as z:
 data={i.filename:z.read(i.filename) for i in z.infolist()};changed={};updated=[]
 for s in range(1,4):
  part=f'xl/worksheets/sheet{s}.xml';xml=data[part].decode()
  for row in E.fromstring(data[part]).findall('m:sheetData/m:row',ns):
   c={re.match('[A-Z]+',v.get('r')).group():''.join(v.itertext()) for v in row.findall('m:c',ns)}
   name=c.get('I' if s==1 else 'G','').strip('/')
   if name not in names:continue
   reqcol='M' if s==1 else 'K';rescol='T' if s==1 else 'R'
   request=c.get(reqcol,'') if 'JSONC' in c.get(reqcol,'') else examples[name]['requestCell']
   response=c.get(rescol,'') if 'Illustrative complete response' in c.get(rescol,'') else examples[name]['responseCell']
   response=re.sub(r'("(?:checkIn|checkInTime)"\s*:\s*)"[^"\n]*"',lambda m:m.group(1)+'"2026-11-11T11:33:00.000+05:30"',response)
   response=re.sub(r'("(?:checkOut|checkOutTime)"\s*:\s*)"[^"\n]*"',lambda m:m.group(1)+'"2026-11-11T12:33:00.000+05:30"',response)
   response+='\n\n// VISITOR LOCAL TIME: checkIn/checkOut or checkInTime/checkOutTime use local IST ISO-8601 with explicit +05:30 offset.\n// Example stored UTC check_in 2026-11-11 06:03:00 -> response 2026-11-11T11:33:00.000+05:30 (11:33 am IST).\n// Null timestamps remain null; explicit input offsets preserve the instant. Existing request keys, approval/status behavior and ordering are unchanged.\n// JSONC: remove // comments before sending JSON.'
   number=row.get('r');desc='K' if s==1 else 'I'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Visitor check-in/check-out response values now consistently use IST ISO-8601 with explicit +05:30 offset, across admin, security and resident log APIs. Offset-less check_in/check_out database values represent UTC from existing writers; null values stay null. Existing response field names and ordering are preserved.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/'+name+'/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions'/name/'index.ts').read_bytes()).hexdigest()+'\nVerified: supabase/tests/visitor-local-time.mjs (UTC and IST environments), admin-visitor-order.mjs and visitor-creation-flow.mjs. Mocked tests; live UI not tested.'}
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
print('Workbook validated, updated visitor time rows:',updated)
