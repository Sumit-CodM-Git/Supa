"""Isolated live resident payment upload test; credentials stay in memory."""
import base64, hashlib, importlib.util, json, subprocess, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('live_api_helpers', ROOT / 'supabase/tests/live-visitor-name-check.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
resident = '3096f2ea-dba7-46fa-9b56-00add869b034'
reg = 'GZB-1234-ab'
marker = 'UPLOAD-TEST-' + uuid.uuid4().hex[:12].upper()
filename = marker + '.png'
payment_uuid = None
object_key = None
uploaded = False
report = {'test_payment_id': marker, 'filename': filename, 'checks': [], 'cleanup': {}}
image = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1XcAAAAASUVORK5CYII=')

def check(label, condition, **details):
    report['checks'].append({'check': label, 'passed': bool(condition), **details})
    print(label + ': ' + ('PASS' if condition else 'FAIL'), flush=True)
    if not condition:
        raise RuntimeError(label + ' failed')

def curl_bytes(url, method='GET', content=None):
    config = ['url = ' + json.dumps(url), 'request = ' + json.dumps(method),
              'output = ' + json.dumps(str(ROOT / 'artifacts/payment-upload-live-test/transfer.bin')),
              'write-out = "%{http_code}"']
    args = ['/usr/bin/curl', '--silent', '--show-error', '--max-time', '35', '--config', '-']
    if content is not None:
        # Input URL is passed through stdin config; image comes from the local fixture.
        fixture = ROOT / 'artifacts/payment-upload-live-test' / filename
        fixture.write_bytes(content)
        config += ['header = "Content-Type: image/png"', 'data-binary = ' + json.dumps('@' + str(fixture))]
    p = subprocess.run(args, input='\n'.join(config), capture_output=True, text=True, timeout=40)
    if p.returncode:
        raise RuntimeError('Storage HTTP transfer failed; credential-bearing output withheld')
    return int(p.stdout), (ROOT / 'artifacts/payment-upload-live-test/transfer.bin').read_bytes()

try:
    actor = api.db('SELECT c.phone FROM public."SSP_Society_User" u '
                   'JOIN public."SSP_Contact" c ON c.contact_id=u.contact '
                   f"WHERE u.user_id='{resident}';")[0]
    credentials = {'phoneNumber': str(actor['phone']), 'registrationNumber': reg}
    status, otp = api.post('get-otp', credentials, record=False)
    check('Resident test login OTP', status == 200 and bool(otp.get('otp')), http_status=status)
    status, login = api.post('verify-otp', {**credentials, 'otp': otp['otp']}, record=False)
    check('Resident authentication', status == 200 and bool(login.get('token')), http_status=status)
    token = login['token']
    rows = api.db('INSERT INTO public."SSP_Payment" '
                  '(payment_id,amount,payment_status,payment_type,payment_method,society_user) '
                  f"VALUES ('{marker}',0,'unpaid','facility_booking','PENDING','{resident}') RETURNING pay_rec_id;")
    payment_uuid = rows[0]['pay_rec_id']
    payload = {'actionType': 'SUBMIT_PAYMENT', 'societyRegistrationNumber': reg,
               'paymentId': marker, 'fileName': filename, 'fileType': 'image/png', 'fileSize': len(image)}
    status, response = api.post('resident-payments-console', payload, token, record=False)
    check('SUBMIT_PAYMENT returns upload URL', status == 200 and bool(response.get('data', {}).get('uploadUrl')),
          http_status=status, response_error=response.get('message'))
    data = response['data']
    report['submission'] = data['paymentSubmission']
    docs = api.db(f'SELECT s3_path FROM public."SSP_Document" WHERE payment=\'{payment_uuid}\';')
    check('Document reference saved', len(docs) == 1)
    object_key = docs[0]['s3_path'].split('/society-documents/', 1)[1]
    report['object_key'] = object_key
    before = api.db(f"SELECT id FROM storage.objects WHERE bucket_id='society-documents' AND name='{object_key}';")
    check('No object before binary upload', not before)
    status, body = curl_bytes(data['uploadUrl'], 'PUT', image)
    uploaded = status in (200, 201)
    check('PUT image to signed upload URL', uploaded, http_status=status)
    objects = api.db(f"SELECT id,metadata->>'size' AS size,metadata->>'mimetype' AS mime FROM storage.objects WHERE bucket_id='society-documents' AND name='{object_key}';")
    check('Storage object exists with expected size', len(objects) == 1 and int(objects[0]['size']) == len(image),
          expected_bytes=len(image), stored=objects)
    status, confirmation = api.post('resident-payments-console', {
        'actionType': 'CONFIRM_RECEIPT_UPLOAD', 'societyRegistrationNumber': reg, 'paymentId': marker}, token, record=False)
    check('Upload confirmation succeeds', status == 200 and confirmation.get('data', {}).get('paymentSubmission', {}).get('receiptUploadStatus') == 'uploaded', http_status=status)
    status, fetched = api.post('resident-payments-console', {
        'actionType': 'FETCH_OWN', 'societyRegistrationNumber': reg, 'search': marker, 'page': 1, 'limit': 100}, token, record=False)
    item = next((p for p in fetched.get('data', {}).get('payments', []) if p['customPaymentId'] == payment_uuid), None)
    check('FETCH_OWN returns signed image URL', status == 200 and item and bool(item.get('receiptUrl')), http_status=status)
    status, downloaded = curl_bytes(item['receiptUrl'])
    check('Downloaded image exactly matches uploaded bytes', status == 200 and downloaded == image,
          http_status=status, sha256=hashlib.sha256(downloaded).hexdigest())
    state = api.db(f'SELECT payment_status FROM public."SSP_Payment" WHERE pay_rec_id=\'{payment_uuid}\';')[0]
    check('Confirmed test payment is UNDER REVIEW', state['payment_status'] == 'UNDER REVIEW')
    report['result'] = 'passed'
except Exception as error:
    report['result'] = 'failed'
    report['error'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
    print('Test failed: ' + report['error'], flush=True)
finally:
    if object_key:
        result = subprocess.run(['supabase', 'storage', 'rm', 'ss:///society-documents/' + object_key,
                                 '--linked', '--project-ref', api.PROJECT, '--experimental', '--yes'], capture_output=True, text=True, timeout=45)
        report['cleanup']['test_object_removed'] = result.returncode == 0
    if payment_uuid:
        api.db(f'DELETE FROM public."SSP_Document" WHERE payment=\'{payment_uuid}\';')
        api.db(f'DELETE FROM public."SSP_Payment" WHERE pay_rec_id=\'{payment_uuid}\' AND payment_id=\'{marker}\';')
        report['cleanup']['test_payment_and_document_removed'] = True
    if object_key:
        remaining = api.db(f"SELECT id FROM storage.objects WHERE bucket_id='society-documents' AND name='{object_key}';")
        report['cleanup']['verified_object_absent'] = not remaining
    (ROOT / 'artifacts/payment-upload-live-test/result.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'result': report['result'], 'cleanup': report['cleanup'], 'object_key': object_key}), flush=True)
raise SystemExit(0 if report['result'] == 'passed' and all(report['cleanup'].values()) else 1)
