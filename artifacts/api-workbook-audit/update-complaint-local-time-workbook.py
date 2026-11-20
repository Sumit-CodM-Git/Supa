from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,hashlib,json
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';full=root/'Society Sync Pro 2.0 - APIs - Full Examples.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
names={'manage-complaint-admin','crud-resident-complaint'};iso={'manage-complaint-admin','crud-resident-complaint'}
def rows(z,s):
 result=[]
 for row in E.fromstring(z.read(f'xl/worksheets/sheet{s}.xml')).findall('m:sheetData/m:row',ns):
  c={re.match('[A-Z]+',x.get('r')).group():''.join(x.find('m:is',ns).itertext()) for x in row.findall('m:c',ns) if x.get('t')=='inlineStr'};name=c.get('I' if s==1 else 'G','').strip('/')
  if name in names:result.append((int(row.get('r')),name,c))
 return result
updates=[];seen=set()
with zipfile.ZipFile(book) as z,zipfile.ZipFile(full) as f:
 data={i.filename:z.read(i.filename) for i in z.infolist()};changed={}
 backup=root/'artifacts/api-workbook-audit/before-complaint-local-time-workbook.xlsx'
 if not backup.exists():backup.write_bytes(book.read_bytes())
 for s in range(1,4):
  part=f'xl/worksheets/sheet{s}.xml';xml=data[part].decode();fullrows={name:c for _,name,c in rows(f,s)}
  for number,name,c in rows(z,s):
   seen.add(name);req='M' if s==1 else 'K';res='T' if s==1 else 'R';desc='K' if s==1 else 'I';ref='U' if s==1 else 'T';date='S' if s==1 else 'Q'
   request=c[req] if '// JSONC documentation' in c[req] else fullrows[name][req]
   response=(c[res] if '// Illustrative complete response examples' in c[res] else fullrows[name][res]).split('// ASSIGNMENT TIME EXAMPLE')[0].rstrip()
   example='2026-11-11T14:47:00.000+05:30' if name in iso else '11/11/2026, 02:47:00 pm'
   response=re.sub(r'("assignedDateTime"\s*:\s*)"[^"\n]*"',lambda m:m.group(1)+json.dumps(example),response)
   note='Assignment time fix: SSP_Complaint.assigned_date_time is an IST wall-clock timestamp without timezone. It is interpreted as Asia/Kolkata once, preventing an extra +05:30 conversion. Existing database values are not rewritten. '
   note+=('assignedDateTime is now a local IST ISO-8601 string with explicit +05:30 offset (2026-11-11T14:47:00.000+05:30 = 02:47 pm IST). Preserve its offset when parsing; the response already expresses local time.' if name in iso else 'assignedDateTime retains its existing en-IN display-string format in Asia/Kolkata (for example 11/11/2026, 02:47:00 pm). Existing createdAt and completionDateTime behavior is unchanged.')
   response+='\n\n// ASSIGNMENT TIME EXAMPLE\n// Stored assigned_date_time: 2026-11-11 14:47:00 (IST wall clock, not UTC).\n// Correct vendor display: 02:47 pm IST; do not display 08:17 pm.\n// '+('API assignedDateTime: '+example+'; already expressed in IST with explicit +05:30 offset.' if name in iso else 'API assignedDateTime: '+example+'; this is already an IST display value.')+'\n// Null assignment timestamps remain null.'
   values={req:request,res:response,desc:c[desc].split('Assignment time fix:')[0].rstrip()+' '+note,date:'2026-11-11',ref:'supabase/functions/'+name+'/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions'/name/'index.ts').read_bytes()).hexdigest()+'\nShared helper: supabase/functions/_shared/complaint-time.ts\nVerified: complaint-assignment-time.mjs, staff-complaint-counts.mjs; mocked regression tests, not live complaint mutations.'}
   for col,value in values.items():
    assert len(value.encode('utf-16-le'))//2<=32767
    cellref=col+str(number);m=re.search(r'<c\b[^>]*\br="'+cellref+r'"[^>]*(?:/>|>.*?</c>)',xml,re.S);assert m
    style=re.search(r'\bs="([^"]+)"',m.group());style=style.group(1) if style else '46';cell=f'<c r="{cellref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>';xml=xml[:m.start()]+cell+xml[m.end():]
   updates.append({'sheet':s,'row':number,'api':name})
  if xml.encode()!=data[part]:changed[part]=xml.encode();E.fromstring(changed[part])
 assert seen==names
 temp=book.with_suffix('.pending.xlsx')
 with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(info,changed.get(info.filename,data[info.filename]))
with zipfile.ZipFile(temp) as out:
 assert out.testzip() is None
 for part,old in data.items():
  if part not in changed:assert out.read(part)==old
 for s in range(1,4):
  for _,_,c in rows(out,s):assert 'ASSIGNMENT TIME EXAMPLE' in c['T' if s==1 else 'R']
temp.replace(book)
print(json.dumps({'updatedWorkbook':book.name,'rows':updates,'unrelatedWorkbookPartsUnchanged':True},indent=2))
