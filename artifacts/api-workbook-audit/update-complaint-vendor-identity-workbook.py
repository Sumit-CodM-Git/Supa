from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
examples=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())
names={'complaint-otp'}
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
   request+='\n\n// Applies to both service-agent and vendor assignments; identity comes from the verified session, never from a body-supplied staffId.\n// REQUEST START OTP\n'+json.dumps({'complaintId':'<COMPLAINT_UUID>','stage':'START'},indent=2)+'\n// VERIFY START OTP\n'+json.dumps({'complaintId':'<COMPLAINT_UUID>','stage':'START','otp':'<6_DIGIT_OTP>'},indent=2)+'\n// REQUEST END OTP (after START verified)\n'+json.dumps({'complaintId':'<COMPLAINT_UUID>','stage':'END'},indent=2)+'\n// VERIFY END OTP\n'+json.dumps({'complaintId':'<COMPLAINT_UUID>','stage':'END','otp':'<6_DIGIT_OTP>'},indent=2)+'\n// stage allowed: START, END.'
   response+='\n\n// Vendor identity fix: verified society-user sessions can access their assigned vendor profile only when stored phone and society match. Direct vendor sessions and legacy phone-auth sessions remain supported. Deleted/wrong-role vendors, mismatched society/phone and other assignees are rejected.\n// COMPLETE END VERIFICATION RESPONSE\n'+json.dumps({'success':True,'data':{'complaintId':'<COMPLAINT_UUID>','stage':'END','otpVerified':True,'status':'resolved','nextStep':'COMPLETED','message':'Work completed successfully.'}},indent=2)+'\n// Existing request keys, wrappers, OTP TTL, START-before-END requirement and state transitions remain unchanged.\n// JSONC examples: remove // comments before sending JSON.'
   number=row.get('r');desc='K' if s==1 else 'I'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Vendor authorization resolves the verified application user to the assigned vendor through matching stored phone and society; direct vendor and legacy auth sessions remain supported. Separate auth.users and application IDs are handled explicitly. Request/response contracts and OTP cycle behavior are unchanged.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/'+name+'/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions'/name/'index.ts').read_bytes()).hexdigest()+'\nVerified: complaint-assignee-identity.mjs and complaint-otp-cycle.mjs. Live Mansi baseline reproduced vendor START 403; post-deploy verification is recorded in artifacts/complaint-otp/mansi-live-results.json. Shared authorization: supabase/functions/_shared/staff.ts.'}
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
print('Workbook validated, updated complaint OTP rows:',updated)
