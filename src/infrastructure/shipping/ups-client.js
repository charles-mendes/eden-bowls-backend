const { fetchJson } = require('../http/fetch-json');
const { HttpError } = require('../../core/http-error');

const SERVICE_LABELS = {
  '03': 'UPS Ground',
  '02': 'UPS 2nd Day Air',
  '01': 'UPS Next Day Air',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '59': 'UPS 2nd Day Air A.M.',
  '11': 'UPS Standard'
};

function serviceLabel(code) {
  const key = String(code || '').trim();
  return SERVICE_LABELS[key] || `UPS ${key || 'Service'}`;
}

function pickRate(ratedShipments, allowedServiceCodes = ['03']) {
  const allowed = new Set((allowedServiceCodes || []).map((code) => String(code).trim()).filter(Boolean));
  const rows = (Array.isArray(ratedShipments) ? ratedShipments : [])
    .map((row) => {
      const code = String(row?.Service?.Code || row?.serviceCode || '').trim();
      const monetary = Number(row?.TotalCharges?.MonetaryValue || row?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue || row?.monetaryValue || NaN);
      const daysRaw = row?.GuaranteedDelivery?.BusinessDaysInTransit
        || row?.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit
        || row?.deliveryDays;
      const deliveryDays = Number(daysRaw);
      return {
        serviceCode: code,
        monetaryValue: monetary,
        deliveryDays: Number.isFinite(deliveryDays) && deliveryDays > 0 ? deliveryDays : null,
        currency: String(row?.TotalCharges?.CurrencyCode || row?.currency || 'USD').toUpperCase(),
        label: serviceLabel(code),
        raw: row
      };
    })
    .filter((row) => row.serviceCode && Number.isFinite(row.monetaryValue) && row.monetaryValue >= 0);

  const eligible = allowed.size > 0
    ? rows.filter((row) => allowed.has(row.serviceCode))
    : rows;

  if (!eligible.length) {
    return null;
  }

  const ground = eligible.find((row) => row.serviceCode === '03');
  if (ground) {
    return ground;
  }

  return eligible.slice().sort((a, b) => a.monetaryValue - b.monetaryValue)[0];
}

class UpsClient {
  constructor(options = {}) {
    this.clientId = String(options.clientId || '').trim();
    this.clientSecret = String(options.clientSecret || '').trim();
    this.accountNumber = String(options.accountNumber || '').trim();
    this.envName = String(options.env || 'cie').trim().toLowerCase() === 'production' ? 'production' : 'cie';
    this.timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 5000;
    this.transactionSrc = String(options.transactionSrc || 'eden-bowls').trim() || 'eden-bowls';
    this.fetchImpl = options.fetchImpl;
    this.tokenCache = null;
  }

  get baseUrl() {
    return this.envName === 'production'
      ? 'https://onlinetools.ups.com'
      : 'https://wwwcie.ups.com';
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      throw new HttpError(503, 'UPS credentials are not configured.', { code: 'ups_not_configured' });
    }
  }

  async request(path, options = {}) {
    this.ensureConfigured();
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {})
    };
    if (options.jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetchJson(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.jsonBody !== undefined ? options.jsonBody : options.body,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl
    });

    if (response.timeout) {
      const error = new HttpError(504, 'UPS request timed out.', { code: 'ups_timeout' });
      error.upsTimeout = true;
      throw error;
    }

    if (response.networkError) {
      const error = new HttpError(503, 'UPS network error.', { code: 'ups_network_error' });
      error.upsNetwork = true;
      throw error;
    }

    if (!response.ok) {
      const message = response.body?.response?.errors?.[0]?.message
        || response.body?.message
        || 'UPS request failed.';
      throw new HttpError(502, message, {
        code: 'ups_upstream_error',
        status: response.status,
        body: response.body
      });
    }

    return response.body;
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 30_000) {
      return this.tokenCache.accessToken;
    }

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const headers = {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    };
    if (this.accountNumber) {
      headers['x-merchant-id'] = this.accountNumber;
    }

    const response = await fetchJson(`${this.baseUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers,
      body: 'grant_type=client_credentials',
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl
    });

    if (response.timeout) {
      throw new HttpError(504, 'UPS OAuth timed out.', { code: 'ups_timeout' });
    }
    if (!response.ok || !response.body?.access_token) {
      throw new HttpError(502, 'Unable to authenticate with UPS.', {
        code: 'ups_oauth_failed',
        status: response.status,
        body: response.body
      });
    }

    const expiresIn = Number(response.body.expires_in || 14399);
    this.tokenCache = {
      accessToken: String(response.body.access_token),
      expiresAt: now + Math.max(60, expiresIn) * 1000
    };
    return this.tokenCache.accessToken;
  }

  async authHeaders() {
    const token = await this.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      transId: `eden-${Date.now()}`,
      transactionSrc: this.transactionSrc,
      ...(this.accountNumber ? { 'x-merchant-id': this.accountNumber } : {})
    };
  }

  buildAddress(party = {}) {
    return {
      Name: String(party.name || 'Shipper').slice(0, 35),
      AttentionName: String(party.name || 'Shipper').slice(0, 35),
      Phone: party.phone ? { Number: String(party.phone).replace(/\D/g, '').slice(0, 15) || '0000000000' } : undefined,
      ShipperNumber: party.shipperNumber || undefined,
      Address: {
        AddressLine: [party.street, party.street2].filter(Boolean).map((line) => String(line).slice(0, 35)),
        City: String(party.city || '').slice(0, 30),
        StateProvinceCode: String(party.state || '').slice(0, 5),
        PostalCode: String(party.zipcode || party.postalCode || '').replace(/\D/g, '').slice(0, 9),
        CountryCode: String(party.country || 'US').toUpperCase().slice(0, 2)
      }
    };
  }

  buildPackage(pkg = {}) {
    return {
      PackagingType: { Code: '02', Description: 'Customer Supplied Package' },
      Dimensions: {
        UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
        Length: String(Number(pkg.length_in || pkg.length || 12)),
        Width: String(Number(pkg.width_in || pkg.width || 12)),
        Height: String(Number(pkg.height_in || pkg.height || 12))
      },
      PackageWeight: {
        UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
        Weight: String(Number(pkg.weight_lb || pkg.weight || 10))
      }
    };
  }

  async rate({ shipFrom, shipTo, package: pkg, allowedServiceCodes }) {
    const headers = await this.authHeaders();
    const shipper = this.buildAddress({ ...shipFrom, shipperNumber: this.accountNumber });
    const shipToAddress = this.buildAddress(shipTo);

    const body = {
      RateRequest: {
        Request: {
          TransactionReference: { CustomerContext: 'eden-bowls-rate' }
        },
        Shipment: {
          Shipper: shipper,
          ShipTo: shipToAddress,
          ShipFrom: this.buildAddress(shipFrom),
          PaymentDetails: this.accountNumber ? {
            ShipmentCharge: {
              Type: '01',
              BillShipper: { AccountNumber: this.accountNumber }
            }
          } : undefined,
          Package: this.buildPackage(pkg)
        }
      }
    };

    const response = await this.request('/api/rating/v2403/Shop', {
      method: 'POST',
      headers,
      jsonBody: body
    });

    const rated = response?.RateResponse?.RatedShipment
      || response?.RatedShipment
      || [];
    const list = Array.isArray(rated) ? rated : [rated];
    const selected = pickRate(list, allowedServiceCodes);
    if (!selected) {
      throw new HttpError(422, 'No UPS rates available for this destination.', { code: 'ups_no_rates' });
    }

    return {
      ...selected,
      ratedShipments: list
    };
  }

  async createShipment({ shipFrom, shipTo, package: pkg, serviceCode }) {
    const headers = await this.authHeaders();
    const code = String(serviceCode || '03').trim() || '03';
    const body = {
      ShipmentRequest: {
        Request: {
          SubVersion: '1801',
          RequestOption: 'nonvalidate',
          TransactionReference: { CustomerContext: 'eden-bowls-ship' }
        },
        Shipment: {
          Description: 'Eden Bowls frozen meals',
          Shipper: this.buildAddress({ ...shipFrom, shipperNumber: this.accountNumber }),
          ShipTo: this.buildAddress(shipTo),
          ShipFrom: this.buildAddress(shipFrom),
          PaymentInformation: {
            ShipmentCharge: {
              Type: '01',
              BillShipper: { AccountNumber: this.accountNumber }
            }
          },
          Service: { Code: code, Description: serviceLabel(code) },
          Package: {
            ...this.buildPackage(pkg),
            Description: 'Eden Bowls'
          }
        },
        LabelSpecification: {
          LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
          HTTPUserAgent: 'Mozilla/4.5'
        }
      }
    };

    const response = await this.request('/api/shipments/v2409/ship', {
      method: 'POST',
      headers,
      jsonBody: body
    });

    const results = response?.ShipmentResponse?.ShipmentResults || response?.ShipmentResults || {};
    const packageResults = results.PackageResults;
    const firstPackage = Array.isArray(packageResults) ? packageResults[0] : packageResults;
    const trackingNumber = String(
      firstPackage?.TrackingNumber
      || results.ShipmentIdentificationNumber
      || ''
    ).trim();
    const shipmentId = String(results.ShipmentIdentificationNumber || trackingNumber).trim();
    const labelBase64 = String(
      firstPackage?.ShippingLabel?.GraphicImage
      || firstPackage?.ShippingLabel?.HTMLImage
      || ''
    ).trim();
    const monetaryValue = Number(
      results?.ShipmentCharges?.TotalCharges?.MonetaryValue
      || results?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue
      || NaN
    );

    if (!shipmentId || !trackingNumber) {
      throw new HttpError(502, 'UPS shipment response missing tracking number.', {
        code: 'ups_ship_incomplete',
        body: response
      });
    }

    return {
      upsShipmentId: shipmentId,
      trackingNumber,
      serviceCode: code,
      labelFormat: 'GIF',
      labelBase64,
      monetaryValue: Number.isFinite(monetaryValue) ? monetaryValue : null,
      currency: String(results?.ShipmentCharges?.TotalCharges?.CurrencyCode || 'USD'),
      raw: response
    };
  }

  async track(trackingNumber) {
    const inquiry = String(trackingNumber || '').trim();
    if (!inquiry) {
      throw new HttpError(400, 'Tracking number is required.', { code: 'invalid_tracking' });
    }
    const headers = await this.authHeaders();
    const response = await this.request(`/api/track/v1/details/${encodeURIComponent(inquiry)}`, {
      method: 'GET',
      headers
    });
    return response;
  }

  async voidShipment(shipmentIdentificationNumber) {
    const id = String(shipmentIdentificationNumber || '').trim();
    if (!id) {
      throw new HttpError(400, 'Shipment id is required.', { code: 'invalid_shipment_id' });
    }
    const headers = await this.authHeaders();
    const response = await this.request(`/api/shipments/v2409/void/cancel/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers
    });
    return response;
  }
}

module.exports = {
  UpsClient,
  pickRate,
  serviceLabel,
  SERVICE_LABELS
};
