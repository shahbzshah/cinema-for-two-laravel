# Cinema for Two — Laravel (PHP 8.3 + Apache)
FROM php:8.3-apache

# System deps + PHP extensions Laravel needs (pgsql for Neon, sqlite for local dev, zip for Composer)
RUN apt-get update && apt-get install -y --no-install-recommends \
        git unzip libpq-dev libzip-dev \
    && docker-php-ext-install pdo pdo_pgsql pdo_sqlite zip \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

# Composer (from the official image, no local install needed)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Apache serves public/ (Laravel's front door)
ENV APACHE_DOCUMENT_ROOT=/var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf

WORKDIR /var/www/html

# Install PHP deps first (better layer caching), then the app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist

COPY . .
RUN composer dump-autoload --optimize \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod -R 775 storage bootstrap/cache

# Runs migrations on boot, then serves. APP_KEY, DB_* etc. come from the
# environment (Northflank dashboard) — never baked into the image.
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
