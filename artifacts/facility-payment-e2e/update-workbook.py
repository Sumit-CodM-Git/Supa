from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'facility-console','get-my-facility-bookings','resident-facility-booking','resident-payments-console','make-resident-payment','get-facility-bookings'}
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



    state=json.loads((ROOT/'artifacts/facility-payment-e2e/deployment.json').read_text())
    NOTE='Payment/booking status synchronization: after a stored proof changes SSP_Payment.payment_status to UNDER REVIEW, its linked waiting_payment facility request changes to pending_verification. Cancelled, rejected, approved and otherwise progressed requests are preserved. Upload URL creation alone leaves unpaid/waiting_payment. Admin verification marks the payment Paid and creates the Approved booking. Deployment 2026-11-18: migration 20261118120000 applied to isrqhkshygauaehwfycw; 6 existing waiting requests synchronized. No Edge Function redeployment. Live HTTP verification: '+state['live_http_test']+'. Test approval uses disposable data and does not transfer real money.'
    def ex(label,obj):return label+' (JSONC):\n'+json.dumps(obj,indent=2)
    item={'facilityName':'<CONFIGURED_FACILITY_NAME>','bookingStatus':'pending_verification','startDateTime':'2026-11-20T04:30:00','endDateTime':'2026-11-20T05:30:00','paymentStatus':'UNDER REVIEW','paymentMethod':'qr','capacity':None,'purpose':'Example booking','facilityBookingId':'<REQUEST_UUID>','payRecId':'<PAYMENT_UUID>','recordType':'request','requestId':'<REQUEST_UUID>','createdAt':'2026-11-18T06:00:00Z'}
    facility={'id':'<FACILITY_UUID>','societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','name':'<CONFIGURED_FACILITY_NAME>','type':'<CONFIGURED_FACILITY_TYPE>','description':'Example facility','rules':['<CONFIGURED_RULE>'],'bookingMode':'<CONFIGURED_BOOKING_MODE>','closedDays':['<CONFIGURED_CLOSED_DAY>'],'basePrice':500,'openingTime':'09:00','closingTime':'21:00','isChargeable':True,'onMaintenance':False,'maintenanceStart':None,'maintenanceEnd':None,'maintenanceReason':None,'images':['<SIGNED_FACILITY_IMAGE_URL>'],'imageUrl':'<SIGNED_FACILITY_IMAGE_URL>'}
    matches=[]
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml';xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS:continue
            r=row.get('r');desc_col='K' if first else 'I';req_col='M' if first else 'K';resp_col='T' if first else 'R';audit_col='U' if first else 'T'
            req=cells.get(req_col,'');resp=cells.get(resp_col,'')
            if ep=='get-my-facility-bookings':
                resp=ex('Submitted proof HTTP 200',{'facilities':[item],'errorResponse':None})
                approved={**item,'bookingStatus':'Approved','paymentStatus':'Paid','recordType':'booking','facilityBookingId':'<BOOKING_UUID>','requestId':None}
                resp+='\n\n'+ex('Approved payment HTTP 200',{'facilities':[approved],'errorResponse':None})
                resp+='\n\n'+ex('Resident not found HTTP 404',{'facilities':[],'errorResponse':{'errorCode':'NOT_FOUND','message':'Resident not found in this society.','timestamp':'2026-11-18T06:00:00Z'}})
            if ep=='facility-console':
                resp='\n\n'.join([ex('FETCH_FACILITIES HTTP 200',{'success':True,'data':{'facilities':[facility]}}),ex('FETCH_SCHEDULE HTTP 200',{'success':True,'data':{'facilitiesSchedules':[{'facilityId':'<FACILITY_UUID>','facilityName':'<CONFIGURED_FACILITY_NAME>','facilityType':'<CONFIGURED_FACILITY_TYPE>','bookingDate':'2026-11-20','slots':[{'startTime':'10:00 AM','endTime':'11:00 AM','status':'Available','onMaintenance':False}]}]}}),ex('FETCH_MY_BOOKINGS HTTP 200 (submitted proof)',{'success':True,'data':{'myBookings':[item]}})])
                req=req.replace(' // Allowed: FETCH_FACILITIES, FETCH_SCHEDULE, FETCH_MY_BOOKINGS','')
                req=re.sub(r'("actionType": "[^"]+",?)',r'\1 // Allowed: FETCH_FACILITIES, FETCH_SCHEDULE, FETCH_MY_BOOKINGS',req)
            if not req.startswith('JSONC'):req='JSONC examples; remove // comments before sending JSON. Use actual society facility configuration for dynamic choices.\n\n'+req
            if not resp.startswith('JSONC'):resp='JSONC examples; remove // comments before sending JSON. Use actual society facility configuration for dynamic choices.\n\n'+resp
            # Keep existing initial unpaid examples. Add a complete post-upload list example.
            if ep=='resident-facility-booking':
                response={'success':True,'data':{'action':'list_bookings','availableFacilities':None,'facilityBooking':None,'bookings':[{'requestId':'<REQUEST_UUID>','bookingId':None,'recordType':'request','status':'pending_verification','bookingStart':'2026-11-20T04:30:00Z','bookingEnd':'2026-11-20T05:30:00Z','isAllDay':False,'purpose':'Example booking','createdAt':'2026-11-18T06:00:00Z','facility':{'id':'<FACILITY_UUID>','name':'<CONFIGURED_FACILITY_NAME>','bookingMode':'<CONFIGURED_BOOKING_MODE>'},'payment':{'payRecId':'<PAYMENT_UUID>','paymentId':'PAY-EXAMPLE','amount':500,'status':'UNDER REVIEW'},'canCancel':False}],'blockedSlots':None,'uploadUrl':None,'documentId':None,'paymentId':None,'pagination':{'page':1,'limit':10,'total':1,'totalPages':1}}}
                resp=resp.split('\n\nPost-upload synchronized list_bookings')[0]+'\n\n'+ex('Post-upload synchronized list_bookings HTTP 200',response)
            if ep in {'get-my-facility-bookings','facility-console'}:
                resp=re.sub(r'("recordType": "request",?)',r'\1 // Allowed: booking, request',resp)
                resp=re.sub(r'("status": "Available",?)',r'\1 // Allowed: Available, Booked, Closed, Unavailable',resp)
                resp=re.sub(r'("paymentStatus": "UNDER REVIEW",?)',r'\1 // Workflow states: unpaid, UNDER REVIEW, Paid, Rejected',resp)
            desc=cells.get(desc_col,'').split('\n\nPayment/booking status synchronization:')[0]+'\n\n'+NOTE
            audit=cells.get(audit_col,'').split('\n2026-11-18 facility review synchronization:')[0]+'\n2026-11-18 facility review synchronization: '+NOTE+' Local PGlite synchronization/backfill/status-preservation tests passed. Report: artifacts/facility-payment-e2e/live-result.json. No real resident payment or proof changed by the disposable HTTP test.'
            vals={desc_col:desc,req_col:req,resp_col:resp,('S' if first else 'Q'):'2026-11-18',audit_col:audit}
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
        for c in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            if c.get('r') not in [('M' if i==1 else 'K')+r,('T' if i==1 else 'R')+r]:continue
            v=re.sub(r'(?m)(?<=\s)//[^\n]*','',text_of(c));decoder=json.JSONDecoder();pos=0
            for m in re.finditer(r'(?m)^\s*\{',v):
                start=v.index('{',m.start())
                if start<pos:continue
                _,size=decoder.raw_decode(v[start:]);count+=1;pos=start+size
    assert count>=30,count
temp.replace(BOOK)
report={'updated_rows':matches,'jsonc_examples_validated':count,'unrelated_package_parts_preserved':True,'deployment':state}
(ROOT/'artifacts/facility-payment-e2e/workbook-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
