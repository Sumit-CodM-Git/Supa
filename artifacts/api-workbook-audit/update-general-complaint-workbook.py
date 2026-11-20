from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];workbook=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';full=root/'Society Sync Pro 2.0 - APIs - Full Examples.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
api_names={'manage-complaint-admin','assign-complaint'}
def rows(z,sheet):
 out=[]
 for row in E.fromstring(z.read(f'xl/worksheets/sheet{sheet}.xml')).findall('m:sheetData/m:row',ns):
  cells={re.match('[A-Z]+',c.get('r')).group():''.join(c.find('m:is',ns).itertext()) for c in row.findall('m:c',ns) if c.get('t')=='inlineStr'}
  api=cells.get('I' if sheet==1 else 'G','').lstrip('/')
  if api in api_names:out.append((int(row.get('r')),api,cells))
 return out
staff=[{'id':'00000000-0000-4000-8000-000000000011','name':'Plumbing Agent','phone':'9000000000','role':'service_agent','serviceType':'Plumbing','rating':'4.70','availabilityStatus':'available'}, {'id':'00000000-0000-4000-8000-000000000012','name':'Agent Without Specialty','phone':'9000000001','role':'service_agent','serviceType':None,'rating':'4.20','availabilityStatus':'available'}, {'id':'00000000-0000-4000-8000-000000000013','name':'Electrical Vendor','phone':'9000000002','role':'vendor','serviceType':'Electrical','rating':'4.80','availabilityStatus':None}, {'id':'00000000-0000-4000-8000-000000000014','name':'General Vendor','phone':'9000000003','role':'vendor','serviceType':'General','rating':'4.30','availabilityStatus':None}]
def annotate(obj):
 text=json.dumps(obj,indent=2)
 text=re.sub(r'("role": "(?:service_agent|vendor)"[,]?)',r'\1 // Allowed: service_agent, vendor',text)
 text=text.replace('"complaintType": "General",','"complaintType": "General", // Stored complaint type; General returns all same-society agents/vendors')
 text=text.replace('"action": "STAFF_LIST",','"action": "STAFF_LIST", // Allowed: VIEW, ASSIGN, STAFF_LIST')
 return text
with zipfile.ZipFile(workbook) as z,zipfile.ZipFile(full) as f:
 original={i.filename:z.read(i.filename) for i in z.infolist()};changed={};updates=[]
 backup=root/'artifacts/api-workbook-audit/before-general-complaint-workbook.xlsx'
 if not backup.exists():backup.write_bytes(workbook.read_bytes())
 for sheet in range(1,4):
  part=f'xl/worksheets/sheet{sheet}.xml';xml=original[part].decode();fullrows={api:c for _,api,c in rows(f,sheet)}
  for number,api,cells in rows(z,sheet):
   reqcol='M' if sheet==1 else 'K';rescol='T' if sheet==1 else 'R';desccol='K' if sheet==1 else 'I';sourcecol='U' if sheet==1 else 'T';datecol='S' if sheet==1 else 'Q'
   request=fullrows[api][reqcol]+'\n\n// GENERAL COMPLAINT — list all same-society service agents and vendors.\n// complaintId identifies an existing complaint whose stored complaint_type is General.\n// Complaint type is read from that record; do not add a complaintType request field.\n'
   response=fullrows[api][rescol]+'\n\n// GENERAL COMPLAINT — complete illustrative list response; specialties do not filter this list.\n'
   if api=='manage-complaint-admin':
    body={'action':'STAFF_LIST','complaintId':'00000000-0000-4000-8000-000000000001'}
    result={'success':True,'data':{'complaintId':body['complaintId'],'complaintType':'General','autoAssigned':False,'assignedStaff':None,'availableStaff':staff,'total':4},'errorResponse':None}
   else:
    body={'societyRegistrationNumber':'EXAMPLE-REG-001','complaintId':'00000000-0000-4000-8000-000000000001'}
    available=[{k:v for k,v in s.items() if k!='availabilityStatus'} for s in staff]
    for s in available:
     if s['role']=='service_agent':s['parkingSlot']=None
    result={'success':True,'data':{'assignmentStatus':{'assigned':False,'message':'Multiple staff available (4). Please select one manually.'},'availableStaff':available}}
    request+='// Omit staffId to list candidates; include staffId only for explicit assignment.\n'
   request+=annotate(body);response+=annotate(result)
   description=cells[desccol]+' General complaints (case-insensitive, whitespace-trimmed) return all service agents and vendors belonging to the complaint society, regardless of specialty or missing service configuration. Other complaint types retain their existing matching/fallback rules. Sorting, deduplication, assignment behavior and response wrappers are preserved.'
   source='supabase/functions/'+api+'/index.ts';reference=source+'\nSHA-256: '+hashlib.sha256((root/source).read_bytes()).hexdigest()+'\nReviewed: 2026-11-11\nVerified: node supabase/tests/general-complaint-staff.mjs (mocked regression tests; no live complaint mutation).'
   values={reqcol:request,rescol:response,desccol:description,sourcecol:reference,datecol:'2026-11-11'}
   for col,value in values.items():
    assert len(value.encode('utf-16-le'))//2<=32767
    ref=col+str(number);pat=r'<c\b[^>]*\br="'+ref+r'"[^>]*(?:/>|>.*?</c>)';m=re.search(pat,xml,re.S);assert m,ref
    style=re.search(r'\bs="([^"]+)"',m.group());style=style.group(1) if style else '46'
    cell=f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is></c>'
    xml=xml[:m.start()]+cell+xml[m.end():]
   updates.append({'sheet':sheet,'row':number,'endpoint':api})
  if xml.encode()!=original[part]:changed[part]=xml.encode();E.fromstring(changed[part])
 temp=workbook.with_suffix('.pending.xlsx')
 with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as out:
 assert out.testzip() is None
 for part,value in original.items():
  if part not in changed:assert out.read(part)==value
 assert {x['endpoint'] for x in updates}==api_names
 for sheet in range(1,4):
  for _,api,c in rows(out,sheet):
   assert 'GENERAL COMPLAINT' in c['M' if sheet==1 else 'K']
   assert 'Agent Without Specialty' in c['T' if sheet==1 else 'R']
temp.replace(workbook)
print(json.dumps({'workbook':str(workbook),'updatedRows':updates,'otherWorkbookPartsUnchanged':True},indent=2))
