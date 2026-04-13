const bwipjs = require('bwip-js');

async function generateBarcodeBuffer(chassisNumber) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: 'code128',
        text: String(chassisNumber),
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center',
        textsize: 9,
      },
      (err, png) => {
        if (err) return reject(err);
        resolve(png);
      }
    );
  });
}

async function generateQRCodeBuffer(chassisNumber, make, model) {
  return new Promise((resolve, reject) => {
    bwipjs.toBuffer(
      {
        bcid: 'qrcode',
        text: `${chassisNumber}|${make || ''}|${model || ''}`,
        scale: 4,
      },
      (err, png) => {
        if (err) return reject(err);
        resolve(png);
      }
    );
  });
}

function generateVehicleLabelHTML(vehicle, company, branch) {
  const compName = company?.name || 'Dealership';
  const branchName = branch?.name || '';
  const makeModel = [vehicle.make, vehicle.model, vehicle.variant].filter(Boolean).join(' ');
  const colorYear = [vehicle.color, vehicle.year].filter(Boolean).join(' | ');
  
  const sellingPrice = vehicle.selling_price
    ? `₹${(vehicle.selling_price / 100).toLocaleString('en-IN')}`
    : 'N/A';
    
  const dateAdded = vehicle.created_at
    ? new Date(vehicle.created_at).toLocaleDateString('en-IN')
    : new Date().toLocaleDateString('en-IN');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 0;
    font-family: 'Inter', system-ui, sans-serif;
    color: #111827;
  }
  .label-container {
    width: 80mm;
    height: 50mm;
    padding: 4mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    page-break-inside: avoid;
    border: 1px dotted #ccc; /* For preview debugging, often removed for real print */
    position: relative;
    overflow: hidden;
  }
  .header {
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .header .branch {
    font-weight: 600;
    color: #374151;
  }
  
  .barcode-section {
    text-align: center;
    margin-top: 2mm;
    margin-bottom: 2mm;
  }
  .barcode-section img {
    max-width: 100%;
    height: 12mm;
    display: block;
    margin: 0 auto;
  }
  .chassis-text {
    font-family: monospace;
    font-size: 10px;
    letter-spacing: 1px;
    margin-top: 1mm;
  }
  
  .middle-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .vehicle-details {
    flex: 1;
    padding-right: 2mm;
  }
  .vehicle-make {
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 1px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vehicle-color {
    font-size: 9px;
    color: #4b5563;
  }
  
  .qr-code {
    width: 14mm;
    height: 14mm;
  }
  
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-top: auto;
  }
  .price {
    font-size: 14px;
    font-weight: 800;
  }
  .date {
    font-size: 8px;
    color: #9ca3af;
  }
</style>
</head>
<body>
  <div class="label-container">
    <div class="header">
      <span>${compName}</span>
      <span class="branch">${branchName}</span>
    </div>
    
    <div class="barcode-section">
      <!-- Replace with local server rendered barcode or embed base64 -->
      <img src="http://localhost:4000/api/vehicles/${vehicle.id}/barcode" />
    </div>
    
    <div class="middle-section">
      <div class="vehicle-details">
        <div class="vehicle-make">${makeModel || 'Unknown Vehicle'}</div>
        <div class="vehicle-color">${colorYear}</div>
      </div>
      <!-- Replace with local server rendered QR code or embed base64 -->
      <img class="qr-code" src="http://localhost:4000/api/vehicles/${vehicle.id}/qrcode" />
    </div>
    
    <div class="footer">
      <div class="price">${sellingPrice}</div>
      <div class="date">${dateAdded}</div>
    </div>
  </div>
</body>
</html>`;
}

function generateBatchLabelsHTML(labelsHTML) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body {
    margin: 0;
    padding: 0;
    font-family: 'Inter', system-ui, sans-serif;
  }
  .grid {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    align-content: flex-start;
  }
  .label-wrapper {
    width: 50%; /* 2x2 roughly */
    padding: 2mm;
    box-sizing: border-box;
    page-break-inside: avoid;
  }
</style>
</head>
<body>
  <div class="grid">
    ${labelsHTML.map(html => `<div class="label-wrapper">${html.replace('<body>', '').replace('</body>', '').replace(/<style>[\s\S]*?<\/style>/, '').replace(/<!DOCTYPE html>/, '').replace(/<html>/, '').replace(/<\/html>/, '').replace(/<head>[\s\S]*?<\/head>/, '')}</div>`).join('')}
  </div>
</body>
</html>`;
}

module.exports = {
  generateBarcodeBuffer,
  generateQRCodeBuffer,
  generateVehicleLabelHTML,
  generateBatchLabelsHTML
};
