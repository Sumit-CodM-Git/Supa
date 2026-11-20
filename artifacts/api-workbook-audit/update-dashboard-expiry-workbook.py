from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
x=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())['get-dashboard']
request=x['requestCell']
response=x['responseCell']
response=re.sub(r'("publishedDate"\s*:\s*"[^"\n]*",)',r'\1\n          "expiryDate": "2026-11-30T18:30:00+05:30", // Stored expiry_date, or null when not set.',response)
assert '"expiryDate"' in response
response+='\n\n// Each data.alerts.items entry includes expiryDate from SSP_Alert.expiry_date, for both today and upcoming notices/alerts.\n// Null expiry dates remain null. Existing alert selection, sorting, limits and response fields are unchanged.\n// JSONC documentation: remove // comments before sending JSON.'
with zipfile.ZipFile(book) as z:
 data={i.filename:z.read(i.filename) for i in z.infolist()};changed={};updated=[]
 for s in range(1,4):
  part=f'xl/worksheets/sheet{s}.xml';xml=data[part].decode()
  for row in E.fromstring(data[part]).findall('m:sheetData/m:row',ns):
   c={re.match('[A-Z]+',v.get('r')).group():''.join(v.itertext()) for v in row.findall('m:c',ns)}
   if c.get('I' if s==1 else 'G','').strip('/')!='get-dashboard':continue
   number=row.get('r');desc='K' if s==1 else 'I'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Dashboard alert/notice items now also include expiryDate from SSP_Alert.expiry_date (string or null). Applies to both today and upcoming items; existing filtering, ordering and limits are preserved.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/get-dashboard/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions/get-dashboard/index.ts').read_bytes()).hexdigest()+'\nVerified: targeted formatter checks for notice/alert, today/upcoming and null/missing dates; not a live dashboard request.'}
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
print('Workbook validated, updated get-dashboard rows:',updated)
