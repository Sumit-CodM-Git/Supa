from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
examples=json.loads((root/'artifacts/api-workbook-audit/full-examples.json').read_text())
names={'staff-complaints','send-notification'}
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
   if name=='staff-complaints':
    request+='\n\n// OPEN ASSIGNED COMPLAINT FROM NOTIFICATION — FETCH ignores list filters/search/page when complaintId is supplied.\n'+json.dumps({'societyRegistrationNumber':'GZB-1234-ab','staffType':'SERVICE_AGENT','staffId':'d505bdcd-11e9-48c0-b70f-e75f958278ea','actionType':'FETCH','complaintId':'91ef1d16-06f3-4723-b4a1-c7c80f6f24cf'},indent=2)+'\n// staffType allowed: SERVICE_AGENT, Service Agent, service_agent, ServiceAgent, VENDOR, Vendor.\n// complaintType and priority filters match case-insensitively; custom dates cover the complete IST calendar day.'
    response+='\n\n// DIRECT COMPLAINT FETCH: data.complaints contains only the requested complaint assigned to the validated staffId; an unassigned/missing complaint gives an empty array.\n// Response wrapper/fields remain the same as FETCH above; pagination.page is 1. Status totals still cover all staff assignments.\n// Example matching ID: 91ef1d16-06f3-4723-b4a1-c7c80f6f24cf; status assigned; complaintType general.\n// Existing count behavior, status updates and OTP verification requirements are retained.'
   else:
    response+='\n\n// FCM message.data example (push payload, distinct from the webhook HTTP response):\n'+json.dumps({'notificationId':'0a9501b8-5ffb-4996-aed5-833353d51acc','type':'COMPLAINT_ASSIGNED','screen':'/complaint-details','referenceId':'91ef1d16-06f3-4723-b4a1-c7c80f6f24cf','referenceTable':'SSP_Complaint','title':'Complaint assigned','body':'A complaint has been assigned to you.','complaintId':'91ef1d16-06f3-4723-b4a1-c7c80f6f24cf','staffId':'d505bdcd-11e9-48c0-b70f-e75f958278ea','staffType':'SERVICE_AGENT'},indent=2)+'\n// staffType allowed: SERVICE_AGENT, VENDOR; staff context is added only for staff recipients of complaint notifications.\n// complaintId is added for complaint notifications of all recipient roles. All FCM data values are strings.\n// The frontend notification-tap handler must navigate using screen and complaintId, loading staff-complaints with that ID.\n// Existing visitor routes, webhook HTTP response and recipient/device delivery behavior are preserved.'
   number=row.get('r');desc='K' if s==1 else 'I'
   values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,desc:c.get(desc,'')+' Complaint visibility/navigation update: staff-complaints accepts normalized staff roles, case-insensitive type/priority filters, complete IST day ranges, and direct complaintId fetch preserving assignment scope. Complaint push data includes explicit complaintId and staff context while preserving screen/reference keys. Frontend navigation must consume these fields.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/'+name+'/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions'/name/'index.ts').read_bytes()).hexdigest()+'\nVerified: staff-complaint-visibility.mjs, staff-complaint-counts.mjs, notification-delivery-otp.mjs and targeted notification routing checks. Database assignment read-only check; mocked API tests; live mobile UI not tested.'}
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
print('Workbook validated, updated complaint visibility/routing rows:',updated)
