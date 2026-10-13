require('dotenv').config();
const dpayService = require('./services/dpayService');

async function testDpay() {
  console.log('--- Test konfiguracji dPay ---');
  console.log('Parametr "service" (Nazwa serwisu):', dpayService.getService() || '(BRAK)');
  console.log('Parametr "hash" (Klucz Hash):', dpayService.getSecret() ? '****** (ustawiony)' : '(BRAK)');
  console.log('DPAY_IPN_URL:', process.env.DPAY_IPN_URL || '(domyślny)');

  if (!dpayService.isConfigured()) {
    console.log('\n❌ Brak nazwy serwisu lub klucza hash w backend/.env!');
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
