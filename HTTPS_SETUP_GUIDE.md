# Гайд по настройке HTTPS для Christian RAG Service

## Обзор

Сервис поддерживает два режима работы с HTTPS:
1. **Разработка** - самоподписанные сертификаты
2. **Продакшен** - Let's Encrypt сертификаты

## 1. Разработка (самоподписанные сертификаты)

### Быстрый запуск

```bash
# Клонируйте репозиторий
git clone <repository-url>
cd christian_rag

# Настройте переменные окружения
cp .env.example .env
# Отредактируйте .env файл с вашими данными

# Запустите сервисы
docker-compose up --build
```

Сервис будет доступен по адресам:
- HTTP: http://localhost (перенаправляется на HTTPS)
- HTTPS: https://localhost (самоподписанный сертификат)

### Принятие самоподписанного сертификата

В браузере появится предупреждение о безопасности. Нажмите:
- Chrome: "Дополнительно" → "Перейти на localhost (небезопасно)"
- Firefox: "Дополнительно" → "Принять риск и продолжить"

## 2. Продакшен (Let's Encrypt)

### Предварительные требования

1. **Домен**: Зарегистрированный домен, указывающий на ваш сервер
2. **Сервер**: VPS/сервер с публичным IP
3. **Порты**: Открытые порты 80 и 443

### Настройка переменных окружения

Создайте файл `.env.prod`:

```bash
# Database
POSTGRES_PASSWORD=your_secure_password_here

# Yandex Cloud
YANDEX_FOLDER_ID=your_folder_id
YANDEX_API_KEY=your_api_key

# SSL/Domain
DOMAIN=yourdomain.com
EMAIL=your-email@example.com
```

### Автоматическая настройка Let's Encrypt

```bash
# Сделайте скрипт исполняемым
chmod +x scripts/init-letsencrypt.sh

# Загрузите переменные окружения
export $(cat .env.prod | xargs)

# Запустите инициализацию SSL
./scripts/init-letsencrypt.sh
```

### Ручная настройка Let's Encrypt

1. **Запустите базовые сервисы**:
```bash
docker-compose -f docker-compose.prod.yml up -d postgres app
```

2. **Получите временный сертификат**:
```bash
docker-compose -f docker-compose.prod.yml run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d yourdomain.com
```

3. **Запустите nginx**:
```bash
docker-compose -f docker-compose.prod.yml up -d nginx
```

### Автоматическое обновление сертификатов

1. **Сделайте скрипт исполняемым**:
```bash
chmod +x scripts/renew-ssl.sh
```

2. **Добавьте в crontab для автоматического обновления**:
```bash
# Откройте crontab
crontab -e

# Добавьте строку для обновления каждые 12 часов
0 */12 * * * /path/to/your/project/scripts/renew-ssl.sh >> /var/log/letsencrypt-renew.log 2>&1
```

## 3. Проверка настройки

### Проверка SSL сертификата

```bash
# Проверка сертификата
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com

# Проверка срока действия
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null | openssl x509 -noout -dates
```

### Проверка безопасности

Используйте онлайн-инструменты:
- [SSL Labs Test](https://www.ssllabs.com/ssltest/)
- [Security Headers](https://securityheaders.com/)

## 4. Мониторинг и логи

### Просмотр логов nginx

```bash
# Логи доступа
docker-compose logs nginx

# Логи ошибок
docker-compose exec nginx tail -f /var/log/nginx/error.log

# Логи доступа
docker-compose exec nginx tail -f /var/log/nginx/access.log
```

### Мониторинг сертификатов

```bash
# Проверка статуса сертификата
docker-compose -f docker-compose.prod.yml run --rm certbot certificates
```

## 5. Troubleshooting

### Проблема: "Certificate not found"

```bash
# Проверьте, что сертификат существует
docker-compose -f docker-compose.prod.yml exec nginx ls -la /etc/letsencrypt/live/yourdomain.com/

# Если нет, получите новый сертификат
docker-compose -f docker-compose.prod.yml run --rm certbot certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  -d yourdomain.com
```

### Проблема: "Rate limit exceeded"

Let's Encrypt имеет лимиты:
- 50 сертификатов на домен в неделю
- 5 неудачных попыток в час

Решение:
- Используйте staging режим для тестирования
- Подождите до сброса лимита

### Проблема: "Domain validation failed"

Убедитесь что:
- Домен указывает на ваш сервер
- Порт 80 открыт и доступен
- Nginx правильно настроен для ACME challenge

## 6. Безопасность

### Настройки безопасности в nginx

Конфигурация включает:
- **HSTS**: Принудительное использование HTTPS
- **X-Frame-Options**: Защита от clickjacking
- **X-Content-Type-Options**: Защита от MIME sniffing
- **X-XSS-Protection**: Защита от XSS
- **Referrer-Policy**: Контроль передачи referrer

### Рекомендации

1. **Регулярно обновляйте сертификаты**
2. **Мониторьте логи на подозрительную активность**
3. **Используйте сильные пароли для базы данных**
4. **Ограничьте доступ к серверу через firewall**
5. **Регулярно обновляйте Docker образы**

## 7. Backup и восстановление

### Backup сертификатов

```bash
# Создайте backup папки с сертификатами
docker run --rm -v christian_rag_certbot_conf:/data -v $(pwd):/backup alpine tar czf /backup/certbot-backup.tar.gz -C /data .
```

### Восстановление сертификатов

```bash
# Восстановите сертификаты из backup
docker run --rm -v christian_rag_certbot_conf:/data -v $(pwd):/backup alpine tar xzf /backup/certbot-backup.tar.gz -C /data
```

## 8. Масштабирование

Для высоконагруженных систем рассмотрите:
- **Load Balancer**: HAProxy или AWS ALB
- **CDN**: CloudFlare или AWS CloudFront
- **Multiple instances**: Горизонтальное масштабирование приложения
- **Database clustering**: PostgreSQL кластер

## Поддержка

При возникновении проблем:
1. Проверьте логи всех сервисов
2. Убедитесь в правильности DNS настроек
3. Проверьте доступность портов
4. Обратитесь к документации Let's Encrypt
