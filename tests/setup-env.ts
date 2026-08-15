process.env.JWT_SECRET ??= "test-secret-with-at-least-32-characters";
process.env.CORS_ORIGINS ??= "http://localhost:5173";
// Alto por padrão: os testes de integração fazem muitos logins do mesmo
// endereço. O teste do limite baixa este valor antes de construir o app.
process.env.LOGIN_RATE_LIMIT_MAX ??= "1000";
