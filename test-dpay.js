require('dotenv').config();
const dpayService = require('./services/dpayService');

async function testDpay() {
  console.log('--- Test konfiguracji dPay ---');
  console.log('DPAY_SERVICE_HASH:', process.env.DPAY_SERVICE_HASH ? `${process.env.DPAY_SERVICE_HASH.substring(0, 4)}...` : '(BRAK)');
  console.log('DPAY_SECRET_KEY:', process.env.DPAY_SECRET_KEY ? '****** (ustawiony)' : '(BRAK)');
  console.log('DPAY_IPN_URL:', process.env.DPAY_IPN_URL || '(domyślny)');

  if (!dpayService.isConfigured()) {
    console.log('\n❌ DPAY_SERVICE_HASH lub DPAY_SECRET_KEY nie są jeszcze wpisane w pliku backend/.env!');
    console.log('Wpisz je w backend/.env i uruchom ten skrypt ponownie: node test-dpay.js');
    return;
  }

  console.log('\nPróba utworzenia testowej sesji płatności (Pakiet 100 kredytów - 4.99 zł)...');

  try {
    const result = await dpayService.createPayment({
      user: {
        _id: '660000000000000000000001',
        email: 'test-diagnostic@getquizsolver.com'
      },
      pack: {
        id: 'starter',
        credits: 100
      }
    });

    if (result.success && result.checkoutUrl) {
      console.log('\n✅ SUKCES! Połączenie z dPay działa w 100% poprawnie!');
      console.log('ID Transakcji:', result.transactionId);
      console.log('Wygenerowany URL płatności BLIK:');
      console.log(result.checkoutUrl);
      console.log('\nMożesz otworzyć ten link w przeglądarce, aby zobaczyć oficjalną bramkę BLIK dPay.');
    } else {
      console.log('\n❌ Bramka dPay zwróciła błąd:');
      console.log(result.error);
    }
  } catch (err) {
    console.error('\n❌ Wyjątek podczas komunikacji z dPay:', err.message);
  }
}

testDpay();
