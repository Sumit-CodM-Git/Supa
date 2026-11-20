from pathlib import Path
import hashlib, re, zipfile, xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]
BOOK = ROOT / 'Society Sync Pro 2.0 - APIs - Updated.xlsx'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
import json, copy
EPS={'resident-payments-console','make-resident-payment','view-resident-payments'}
DEPLOYMENT=json.loads((ROOT/'artifacts/payment-receipt-review/deployment.json').read_text())
STATUS=DEPLOYMENT['status']
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



    NOTE = ('After migration 20261118100000_receipt_upload_payment_review.sql is applied, a nonempty receipt uploaded to society-documents automatically changes its linked UNPAID payment to UNDER REVIEW, including facility bookings. Creating an upload URL alone does not change status. CONFIRM_RECEIPT_UPLOAD remains supported. Re-fetch the payment list after upload completion; UNDER REVIEW means approval pending and the app should suppress Pay Now. Existing unpaid records with stored receipts are repaired by the migration; paid and rejected historical records are preserved. A new receipt upload may resubmit a rejected payment. ') + STATUS + ('')
    def sample(label, obj):
        # Validate each complete illustrative JSONC object before placing in Excel.
        encoded = json.dumps(obj, indent=2)
        json.loads(encoded)
        encoded = encoded.replace('"status": "UNDER REVIEW"', '"status": "UNDER REVIEW"')
        return label+' (JSONC; remove // comments before sending JSON):\n'+encoded
    pay = {'customPaymentId':'54bf4367-8fd5-49c7-b922-fb78d43fd1cd','paymentRecordName':'FAC-2026-11-001','amount':2500,'dueDate':'2026-11-30','monthPeriod':'November 2026','status':'UNDER REVIEW','type':'Facility Booking','description':'Booking for Clubhouse','receiptUrl':'<SIGNED_RECEIPT_URL>','rejectionReason':None,'facilityName':'Clubhouse'}
    payload = {'totalDues':0,'totalPaidAmount':0,'pagination':{'totalCount':1,'currentPage':1,'limit':10,'totalPages':1},'payments':[pay]}
    matches=[]
    for i in range(1,4):
        part=f'xl/worksheets/sheet{i}.xml'
        xml=original[part].decode()
        for row in ET.fromstring(xml).findall('m:sheetData/m:row',NS):
            cells={re.sub(r'\d+$','',c.get('r')):text_of(c) for c in row}
            first=i==1;ep=cells.get('G' if first else 'E','')
            if ep not in EPS: continue
            r=row.get('r');reqcol='M' if first else 'K';respcol='T' if first else 'R'
            req=cells.get(reqcol,'');resp=cells.get(respcol,'')
            req=req.replace('then call CONFIRM_RECEIPT_UPLOAD.', 'then optionally call CONFIRM_RECEIPT_UPLOAD after upload completion. Re-fetch the list to obtain the updated status.')
            resp=resp.replace('payment status remains unchanged until receipt confirmation', 'status remains unchanged until the binary upload completes')
            if ep=='resident-payments-console':
                # Preserve the existing submission and confirmation wrappers/examples.
                resp=resp.split('FETCH_OWN response')[0]+sample('FETCH_OWN response (HTTP 200; facility receipt uploaded, approval pending)',{'success':True,'data':payload})
            if ep=='view-resident-payments':
                req=sample('Fetch own payments',{'societyRegistrationNumber':'<SOCIETY_REGISTRATION_NUMBER>','status':'UNDER REVIEW','paymentType':'Facility Booking','search':'FAC-2026-11','page':1,'limit':10})
                req+='\n// status and paymentType are optional case-insensitive text filters; paymentType must reflect actual SSP_Payment.payment_type values in the society ledger, not a fixed enum.'
                legacy_pay={k:v for k,v in pay.items() if k not in {'receiptUrl','rejectionReason','facilityName'}}
                legacy_pay['description']='Booking for Facility Context ID: <FACILITY_ID>'
                legacy_payload={**payload,'payments':[legacy_pay]}
                resp=sample('Success (HTTP 200)',{'success':True,'data':legacy_payload})
                resp+='\n\n'+sample('Invalid society (HTTP 404)',{'success':False,'error':'ERROR','message':'Society not found.'})
            if not req.startswith('JSONC'):req='JSONC examples; remove // comments before sending JSON.\n\n'+req
            if not resp.startswith('JSONC'):resp='JSONC response examples; remove // comments before sending JSON.\n\n'+resp
            # Actions already carry inline allowed-value comments; annotate status examples.
            for target in ['req','resp']:
                val=req if target=='req' else resp
                val=re.sub(r'("status": "UNDER REVIEW",?)(?![^\n]*//)',r'\1 // UNPAID, UNDER REVIEW, PAID, REJECTED (illustrative workflow states; other stored statuses are returned unchanged)',val)
                if target=='req':req=val
                else:resp=val
            desc=cells.get('K' if first else 'I','').split(' Receipt upload completion:')[0]
            desc=desc.replace('Payment status changes to UNDER REVIEW only after the stored object is confirmed.', 'Receipt confirmation verifies that the stored object exists.')
            desc+=' Receipt upload completion: '+NOTE
            audit=cells.get('U' if first else 'T','').replace('This local migration has not been deployed or live-tested.', 'Initial local review; superseded by deployment verification below.')+'\n2026-11-18 deployment: '+STATUS+' Local PGlite SQL regression and existing payment receipt upload regression passed. Edge handler code unchanged.'
            if ep in {'resident-payments-console','make-resident-payment'}:
                upload_curl='\n\nUpload the actual file after SUBMIT_PAYMENT (raw bytes, separate request):\ncurl --request PUT \"<SIGNED_UPLOAD_URL>\" --header \"Content-Type: image/jpeg\" --data-binary @receipt.jpg\nUse the returned uploadUrl unchanged; send raw file bytes rather than a JSON filename or multipart envelope. Check the upload HTTP result, then re-fetch payments; CONFIRM_RECEIPT_UPLOAD remains available.'
                curlcol='R' if first else 'P'
            values={('K' if first else 'I'):desc,reqcol:req,respcol:resp,('S' if first else 'Q'):'2026-11-18',('U' if first else 'T'):audit}
            if ep in {'resident-payments-console','make-resident-payment'}:
                current_curl=cells.get(curlcol,'').split('\n\nUpload the actual file after SUBMIT_PAYMENT')[0]
                values[curlcol]=current_curl+upload_curl
            statuscol='Q' if first else 'N'
            values[statuscol]=cells.get(statuscol,'').split('\n2026-11-18 receipt upload migration:')[0]+'\n2026-11-18 receipt upload migration: '+STATUS
            for col,value in values.items():xml=replace_cell(xml,col+r,value)
            matches.append([i,r,ep])
        if xml.encode()!=original[part]:changed[part]=xml.encode()
    assert {ep for _,_,ep in matches}==EPS, matches

temp=BOOK.with_suffix('.pending.xlsx')
with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED) as out:
    for info in infos:out.writestr(info,changed.get(info.filename,original[info.filename]))
with zipfile.ZipFile(temp) as check:
    assert check.testzip() is None
    for part,data in original.items():
        if part.endswith('.xml'):ET.fromstring(check.read(part))
        if part not in changed:assert check.read(part)==data,part
    # Validate every JSON/JSONC object in updated example cells, including nested arrays.
    objects=0
    for i,r,ep in matches:
        root=ET.fromstring(check.read(f'xl/worksheets/sheet{i}.xml'))
        for c in root.findall(f'm:sheetData/m:row[@r="{r}"]/m:c',NS):
            if c.get('r') not in [(('M' if i==1 else 'K')+r),(('T' if i==1 else 'R')+r)]:continue
            value=text_of(c)
            # Remove inline JSONC comments only (retain URLs within JSON strings).
            value=re.sub(r'(?m)(?<=\s)//[^\n]*','',value)
            decoder=json.JSONDecoder();pos=0
            while True:
                start=value.find('{',pos)
                if start<0:break
                obj,length=decoder.raw_decode(value[start:]);objects+=1;pos=start+length
    assert objects>=10,objects
temp.replace(BOOK)
result={'updated_rows':matches,'jsonc_examples_validated':objects,'unrelated_package_parts_preserved':True,'status':STATUS}
(ROOT/'artifacts/payment-receipt-review/workbook-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
