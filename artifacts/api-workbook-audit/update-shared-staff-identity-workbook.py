from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
examples=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())
names={'staff-complaints','staff-complaint-workflow','staff-complaint-images','complaint-otp'}
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
   note={
    'staff-complaints':'Vendor staffId accepts either the explicit vendor profile ID or its linked society-user ID. The account link uses stored phone and requested society. Direct profile IDs retain precedence; ambiguous matches require an explicit vendor ID. Pagination, counters, filters and UPDATE response shapes remain unchanged.',
    'staff-complaint-workflow':'Complaint operations share assignment-based identity resolution with complaint-otp. The exact complaint assignee determines the context even when a login has multiple roles or shares a legacy ID across tables. Legacy vendor phone matching normalizes stored and authenticated numbers to their last 10 digits and checks active vendor role. OTP actions, uploads, images and response wrappers are preserved; FETCH_OTP remains resident-scoped.',
    'staff-complaint-images':'UPLOAD uses the same assignment identity resolver as complaint OTP/workflow APIs. Legacy vendor phone matching normalizes stored and authenticated numbers to their last 10 digits and checks the exact assigned active vendor. Existing upload/confirm/FETCH/DELETE request and response shapes remain unchanged.',
    'complaint-otp':'Service-agent and vendor complaint assignments use the same assignment-based identity resolver. Legacy vendor phone matching normalizes stored and authenticated numbers to their last 10 digits and checks the exact assigned active vendor. Direct vendor sessions, society-user linked vendor sessions and legacy phone-auth sessions remain supported.'
   }[name]
   if name=='staff-complaints':
    request+='\n\n// LINKED VENDOR LOGIN EXAMPLE\n'+json.dumps({'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','staffType':'VENDOR','staffId':'<VERIFIED_SOCIETY_USER_UUID_OR_VENDOR_PROFILE_UUID>','actionType':'FETCH','status':'assigned','page':1,'limit':20},indent=2)+'\n// staffType: SERVICE_AGENT, VENDOR (existing role spelling aliases remain supported).'
   request+='\n\n// ACCOUNT IDENTITY COMPATIBILITY: '+note+'\n// No extra identity or phone key is required in the request.'
   response+='\n\n// ACCOUNT IDENTITY COMPATIBILITY: '+note+'\n// Wrong phone/society and deleted profiles are rejected; the user is never assigned by name.\n// Regression checks: staff-identity-compatibility.mjs, complaint-assignee-identity.mjs, complaint-otp-cycle.mjs, staff-complaint-counts.mjs, staff-complaint-visibility.mjs.\n// JSONC examples: remove // comments before sending JSON.'
   number=row.get('r');desc='K' if s==1 else 'I'
   helper=root/'supabase/functions/_shared/staff.ts'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Identity compatibility update: '+note,('S' if s==1 else 'Q'):'2026-11-12',('U' if s==1 else 'T'):'supabase/functions/'+name+'/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions'/name/'index.ts').read_bytes()).hexdigest()+'\nShared helper: supabase/functions/_shared/staff.ts\nShared helper SHA-256: '+hashlib.sha256(helper.read_bytes()).hexdigest()+'\nVerified locally: complaint-assignee-identity.mjs, complaint-otp-cycle.mjs and staff-identity-compatibility.mjs. Deployed 2026-11-12 to Supabase. Post-deploy shared account authentication and SERVICE_AGENT/VENDOR assignment listing both returned HTTP 200; latest full live OTP harness stopped before creating fixtures, so full live OTP sequence is not claimed.'}
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
print('Workbook validated, updated shared staff identity rows:',updated)
