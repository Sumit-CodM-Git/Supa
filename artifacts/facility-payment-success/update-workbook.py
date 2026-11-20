from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-payments-console','make-resident-payment','view-resident-payments','admin-payments-console','get-payments-list','resident-facility-booking','get-my-facility-bookings','facility-console','get-facility-bookings'}
with zipfile.ZipFile(BOOK) as src:
    infos=src.infolist()
    original={i.filename:src.read(i.filename) for i in infos}
    changed={}
    strings=[''.join(si.itertext()) for si in ET.fromstring(original['xl/sharedStrings.xml']).findall('m:si',NS)]
    def text_of(cell):
        if cell is None:
            return ''
        if cell.get('t') == 's':
            return strings[int(cell.find('m:v', NS).text)]
        inline = cell.find('m:is', NS)
        if inline is not None:
            return ''.join(inline.itertext())
        value = cell.find('m:v', NS)
        return value.text if value is not None else ''

    def replace_cell(xml, ref, value):
        assert len(value.encode('utf-16-le')) // 2 <= 32767, (ref, 'Excel cell limit')
        match = re.search(r'<c\b[^>]*\br="' + re.escape(ref) + r'"[^>]*(?:/>|>.*?</c>)', xml, re.S)
        if match:
            style = re.search(r'\bs="([^"]+)"', match.group())
            style_attr = f' s="{style.group(1)}"' if style else ''
            cell = f'<c r="{ref}"{style_attr} t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
            return xml[:match.start()] + cell + xml[match.end():]
        row_num = re.search(r'\d+$', ref).group()
        row_match = re.search(r'<row\b[^>]*\br="' + row_num + r'"[^>]*>', xml)
        assert row_match, ref
        cell = f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{escape(value)}</t></is></c>'
        return xml[:row_match.end()] + cell + xml[row_match.end():]



    deployment=json.loads((ROOT/'artifacts/facility-payment-success/deployment.json').read_text())
    live_path=ROOT/'artifacts/facility-payment-success/live-result.json'
    live=json.loads(live_path.read_text()) if live_path.exists() else {'result':'not run yet'}
    NOTE='Facility payment and approval are independent. Before actual proof upload: payment unpaid, approval waiting_payment. Once a nonempty receipt is stored: payment Successful, approval pending_verification. A signed upload URL or document metadata alone is not proof of upload. Admin VERIFY retains the existing final Paid/Approved result; admin REJECT gives Rejected/rejected. Reconfirming an old proof does not reverse rejection. Other payment types keep UNDER REVIEW. Successful facility submissions count toward totalPaidAmount and not totalDues; this label records the resident submission, not independent bank settlement verification. Official PDF receipts still require final Paid status. Payment-proof bucket society-documents, folder <SOCIETY_REGISTRATION_NUMBER>/financial/. Existing response wrappers and legacy top-level upload aliases are preserved.'
    def approval(status):
        s=str(status or '').strip().lower()
        return 'pending_verification' if s in ['successful','under review'] else 'Approved' if s=='paid' else 'rejected' if s=='rejected' else 'waiting_payment'
    def update(d):
        if isinstance(d,list):return [update(x) for x in d]
        if not isinstance(d,dict):return d
        d={k:update(v) for k,v in d.items()}
        if 'paymentStatus' in d:
            if d['paymentStatus']=='UNDER REVIEW':d['paymentStatus']='Successful'
            d['approvalStatus']=d.get('bookingStatus',approval(d['paymentStatus']))
            if 'paymentType' in d:d['paymentType']='facility_booking'
            if 'paymentName' in d:d['paymentName']='PAY-EXAMPLE'
            if 'paymentID' in d:d['paymentID']='PAY-EXAMPLE'
            if 'receiptInfo' in d:d['receiptInfo']='Facility payment proof submitted'
        if 'paymentRecordName' in d or ('submitted' in d and 'receiptUploadStatus' in d):
            if d.get('status')=='UNDER REVIEW':d['status']='Successful'
            d['approvalStatus']=approval(d.get('status'))
            if 'type' in d:d['type']='Facility Booking'
            if 'description' in d:d['description']='Booking for <CONFIGURED_FACILITY_NAME>'
            if 'facilityName' in d:d['facilityName']='<CONFIGURED_FACILITY_NAME>'
        if 'bookingStatus' in d:d['approvalStatus']=d['bookingStatus']
        if 'recordType' in d and 'status' in d:d['approvalStatus']=d['status']
        if isinstance(d.get('payment'),dict) and d['payment'].get('status')=='UNDER REVIEW':d['payment']['status']='Successful'
        if isinstance(d.get('payments'),list) and 'totalPaidAmount' in d:
            d['totalPaidAmount']=sum(float(x.get('amount',0)) for x in d['payments'] if str(x.get('status','')).lower() in ['successful','paid','success','completed'])
            d['totalDues']=sum(float(x.get('amount',0)) for x in d['payments'] if str(x.get('status','')).lower() in ['unpaid','due','pending','overdue'])
        return d
    def label(obj):
        data=obj.get('data',obj)
        if 'paymentSubmission' in data:return 'SUBMIT_PAYMENT' if data['paymentSubmission'].get('receiptUploadStatus')!='uploaded' else 'CONFIRM_RECEIPT_UPLOAD'
        if data.get('action'):return data['action']
        if 'myBookings' in data:return 'FETCH_MY_BOOKINGS'
        if 'facilitiesSchedules' in data:return 'FETCH_SCHEDULE'
        if 'facilities' in data:return 'FETCH_FACILITIES' if 'success' in obj else 'Resident bookings'
        if 'payments' in data:return 'Payment list'
        if 'bookings' in data:return 'Facility bookings'
        if 'paymentStatus' in data:return 'Admin payment decision'
        return 'Error' if obj.get('success') is False or obj.get('errorResponse') else 'Response'
    def encode(obj):
        out=json.dumps(obj,indent=2)
        for field,comment in {'approvalStatus':'Workflow values: waiting_payment, pending_verification, Approved, rejected, cancelled (other stored states are preserved)','receiptUploadStatus':('Allowed: uploaded, missing, not_provided, unverified' if ep=='get-facility-bookings' else 'Allowed: pending_upload, uploaded, not_provided'),'recordType':'Allowed: booking, request','action':'Allowed: list_facilities, get_blocked_slots, book, list_bookings, cancel_booking, abort_pending_booking','status':'Workflow examples: unpaid, UNPAID, Successful, UNDER REVIEW, Paid, Rejected, waiting_payment, pending_verification, Approved, cancelled (stored value depends on this operation)'}.items():
            out=re.sub(r'("'+field+r'": "[^"\n]+",?)',r'\1 // '+comment,out)
        return out
    matches=[];validated=0
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row};first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS:continue
            r=row.get('r');response_col='T' if first else 'R';request_col='M' if first else 'K';desc_col='K' if first else 'I';audit_col='U' if first else 'T'
            response=cells.get(response_col,'');text=re.sub(r'(?m)(?<=\s)//[^\n]*','',response);decoder=json.JSONDecoder();end=0;examples=[]
            for match in re.finditer(r'(?m)^\s*\{',text):
                start=text.index('{',match.start())
                if start<end:continue
                obj,size=decoder.raw_decode(text[start:]);end=start+size;obj=update(obj);json.loads(json.dumps(obj));validated+=1
                examples.append(label(obj)+' (JSONC illustrative example):\n'+encode(obj))
            assert examples,(ep,'complete response examples required')
            if ep=='get-facility-bookings' and not any('"paymentStatus": "Successful"' in x and '"recordType": "request"' in x for x in examples):
                # The confirmed-booking example is preserved; show pending payment separately.
                pending=copy.deepcopy(obj if 'bookings' in obj else {})
                if pending.get('bookings'):
                    item=pending['bookings'][0];item.update({'recordType':'request','requestId':'<REQUEST_UUID>','bookingId':'<REQUEST_UUID>','paymentStatus':'Successful','approvalStatus':'pending_verification','bookingStatus':'pending_verification'});pending['pending']=1;pending['approved']=0
                    examples.append('Submitted facility payment (JSONC):\n'+encode(pending));validated+=1
            response='JSONC illustrative facility-payment examples. Remove comments before sending JSON. Names, booking modes, payment modes, facility types, rules and prices must come from actual society configuration.\n\n'+'\n\n'.join(examples)+'\n\n'+NOTE
            request=cells.get(request_col,'').split('\n\nCurrent facility payment semantics:')[0]+'\n\nCurrent facility payment semantics: '+NOTE
            audit=cells.get(audit_col,'').split('\n2026-11-18 Successful facility submission:')[0]+'\n2026-11-18 Successful facility submission: '+NOTE+' Migration 20261118140000 deployed. API inventory: '+deployment.get('status','deployment in progress')+'. Live test result: '+live.get('result','not run yet')+'. Tests use disposable data; no real money transferred. See artifacts/facility-payment-success/.'
            vals={desc_col:NOTE,request_col:request,response_col:response,('S' if first else 'Q'):'2026-11-18',audit_col:audit}
            for col,value in vals.items():xml=replace_cell(xml,col+r,value)
            matches.append([i,r,ep])
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    count=0
    for i,r,ep in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for cell in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            if cell.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            v=re.sub(r'(?m)(?<=\s)//[^\n]*','',text_of(cell));pos=0
            for m in re.finditer(r'(?m)^\s*\{',v):
                start=v.index('{',m.start())
                if start<pos:continue
                _,size=json.JSONDecoder().raw_decode(v[start:]);count+=1;pos=start+size
    assert count>=35,count
temp.replace(BOOK)
report={'updated_rows':matches,'complete_jsonc_examples_validated':count,'unrelated_package_parts_preserved':True,'deployment_status':deployment.get('status'),'live_test':live.get('result')}
(ROOT/'artifacts/facility-payment-success/workbook-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
