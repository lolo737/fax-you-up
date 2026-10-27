/**
 * Fax You Up! — the ONE file that decides what we charge.
 *
 * All amounts are in cents (EUR). Change a number here, run `npm test`
 * (a consistency test makes sure the public pages still agree), deploy.
 * The front end never decides a price: it asks /api/pricing and /api/quote,
 * and Stripe is always charged the amount computed on the server from this file.
 */
export const pricing = {
  currency: 'eur',

  perFax: {
    /** Price of one fax of up to `includedPages` pages. */
    basePriceCents: 150,
    includedPages: 3,
    /** Each page beyond `includedPages`. */
    extraPageCents: 50,
    /** Hard ceiling per fax; bigger documents are refused at quote time. */
    maxPages: 50,
  },

  promo: {
    /** A customer's first paid fax (matched by e-mail address) uses this base price. */
    firstFaxEnabled: true,
    firstFaxBasePriceCents: 100,
  },

  subscription: {
    enabled: true,
    monthlyPriceCents: 2499,
    /** Pages a subscriber may send per billing period at no extra charge. */
    includedPagesPerMonth: 300,
    productName: 'Fax You Up! Monthly',
  },

  upload: {
    maxBytes: 5_000_000,
  },

  /**
   * Destinations we accept (E.164 prefixes). Telnyx charges by destination, so
   * we only open the countries the flat price above actually covers.
   */
  allowedDestinationPrefixes: [
    '+353', // Ireland
    '+49', // Germany
    '+44', // United Kingdom
    '+43', // Austria
    '+41', // Switzerland
    '+33', // France
    '+31', // Netherlands
    '+32', // Belgium
    '+34', // Spain
    '+351', // Portugal
    '+39', // Italy
    '+45', // Denmark
    '+46', // Sweden
    '+48', // Poland
    '+1', // USA & Canada
  ],
};

export default pricing;
