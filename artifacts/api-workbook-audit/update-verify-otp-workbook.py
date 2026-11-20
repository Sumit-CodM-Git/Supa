from pathlib import Path
import zipfile,xml.etree.ElementTree as E,re,json,hashlib
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2];book=root/'Society Sync Pro 2.0 - APIs - Updated.xlsx';ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
request='JSONC documentation; remove // comments before sending JSON.\n'+json.dumps({'phoneNumber':'9000000000','registrationNumber':'SSP-001','otp':'123456'},indent=2)
society={'id':'11111111-1111-4111-8111-111111111111','name':'Example Society','registrationNumber':'SSP-001'}
user={'subscriptionPlan':'FREE','id':'22222222-2222-4222-8222-222222222222','name':'Example Resident','phone':'9000000000','email':'resident@example.com','roles':['resident'],'userType':'society_user','society':society}
def example(u):return json.dumps({'success':True,'token':'<JWT_ACCESS_TOKEN>','user':u},indent=2)
response='JSONC illustrative complete responses (not live samples).\nSOCIETY USER — HTTP 200\n'+example(user).replace('"subscriptionPlan": "FREE",','"subscriptionPlan": "FREE", // Actual plan_code from get_my_subscription_summary; FREE fallback, configured paid codes, null when unavailable in summary.').replace('"resident"\n','"resident" // Roles come from the user record; a matching vendor role is also included.\n')
vendor={'id':'33333333-3333-4333-8333-333333333333','name':'Example Vendor','phone':'9000000000','email':'vendor@example.com','roles':['vendor'],'userType':'vendor','subscriptionPlan':None,'vendorId':'44444444-4444-4444-8444-444444444444','society':society}
response+='\n\nSTANDALONE VENDOR — HTTP 200\n'+example(vendor)+'\n// userType allowed values: society_user, vendor.\n// Standalone vendor subscriptionPlan is null because no resident flat subscription applies.\n// subscriptionPlan is a string plan code or null; it does not use the removed SSP_Society subscription_plan column.\n\nINVALID OTP — HTTP 401\n'+json.dumps({'success':False,'error':'UNAUTHORIZED','message':'Invalid OTP. Please try again.'},indent=2)+'\n\nSUBSCRIPTION LOOKUP FAILURE — HTTP 500 (OTP is not consumed)\n'+json.dumps({'success':False,'error':'SERVER_ERROR','message':'Failed to load subscription plan.'},indent=2)
with zipfile.ZipFile(book) as z:
 data={i.filename:z.read(i.filename) for i in z.infolist()};changed={};updated=[]
 for s in range(1,4):
  part=f'xl/worksheets/sheet{s}.xml';xml=data[part].decode()
  for row in E.fromstring(data[part]).findall('m:sheetData/m:row',ns):
   cells={re.match('[A-Z]+',c.get('r')).group():''.join(c.itertext()) for c in row.findall('m:c',ns)}
   if cells.get('I' if s==1 else 'G','').strip('/')!='verify-otp':continue
   number=row.get('r');values={('M' if s==1 else 'K'):request,('T' if s==1 else 'R'):response,('K' if s==1 else 'I'):'Verify a matching OTP and return token, user identity, roles and society. user.subscriptionPlan contains the current flat subscription plan code from get_my_subscription_summary (FREE fallback); standalone vendors receive null. parkingSlot is omitted. Request fields are unchanged.',('S' if s==1 else 'Q'):'2026-11-11',('U' if s==1 else 'T'):'supabase/functions/verify-otp/index.ts\nSource SHA-256: '+hashlib.sha256((root/'supabase/functions/verify-otp/index.ts').read_bytes()).hexdigest()+'\nVerified with mocked regression tests: supabase/tests/verify-otp-subscription.mjs; no live OTP consumed.'}
   if s!=1:values.update({'N':'Mocked login regression checks passed; live OTP login not exercised.','O':'Deployed via Supabase CLI on 2026-11-11; deployment completion reported separately.','S':'Request has no closed enum. userType: society_user, vendor. subscriptionPlan uses actual configured SSP_Subscription_Plan.plan_code values; standalone vendors: null.'})
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
  E.fromstring(out.read(part)) if part.endswith('.xml') else None
  if part not in changed:assert out.read(part)==old
 for part in changed:assert 'parkingSlot' not in response
 temp.replace(book)
print('Workbook updated and validated:',updated)
