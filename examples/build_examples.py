#!/usr/bin/env python3
"""Builds the example reports in examples/*.html from synthetic git repos.

Re-run after changing the template or the collector:  python3 examples/build_examples.py
Commit dates are fixed, so the output is reproducible.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent / "explain_change.py"
ENV = {**os.environ, "GIT_AUTHOR_DATE": "2026-10-01T10:00:00+00:00", "GIT_COMMITTER_DATE": "2026-10-01T10:00:00+00:00",
       "GIT_AUTHOR_NAME": "dev", "GIT_AUTHOR_EMAIL": "dev@example.com",
       "GIT_COMMITTER_NAME": "dev", "GIT_COMMITTER_EMAIL": "dev@example.com"}


def sh(args, cwd):
    p = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(f"{' '.join(map(str, args))}\n{p.stdout}\n{p.stderr}")
    return p.stdout


def write(root: Path, files: dict):
    for path, text in files.items():
        f = root / path
        if text is None:
            f.unlink()
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text.lstrip("\n"), encoding="utf-8")


# ───────────────────────── 1. Rails marketplace: aligned, Spanish ─────────────────────────
RAILS = {
    "stack": "Ruby on Rails · Spanish UI", "shows": "A clean feature across four layers: no violations, Zeitwerk constant resolution, migration and routes, Spanish labels.",
    "name": "01-marketplace-rails-refunds-es",
    "branch": "feature/refunds",
    "message": "Reembolsos idempotentes de pedidos",
    "config": '''
[project]
name = "marketplace"
direction = "Controladores finos; la lógica vive en servicios de aplicación y modelos; integraciones externas aisladas en clients/ y mailers/."
lang = "es"

[[layers]]
id = "web"
name = "Web"
[[layers]]
id = "application"
name = "Aplicación"
[[layers]]
id = "domain"
name = "Dominio"
[[layers]]
id = "infra"
name = "Infraestructura"

[rules]
allow = ["web -> application", "application -> domain", "application -> infra", "infra -> domain"]

[[components]]
id = "controllers"
name = "Controladores"
layer = "web"
paths = ["app/controllers/**", "config/routes.rb"]
[[components]]
id = "checkout"
name = "Checkout"
layer = "application"
paths = ["app/services/checkout/**"]
[[components]]
id = "refunds"
name = "Reembolsos"
layer = "application"
paths = ["app/services/refunds/**"]
desc = "Casos de uso de reembolsos"
[[components]]
id = "models"
name = "Modelos"
layer = "domain"
paths = ["app/models/**"]
[[components]]
id = "payments"
name = "Pasarela de pagos"
layer = "infra"
paths = ["app/clients/payments/**"]
[[components]]
id = "mailers"
name = "Mailers"
layer = "infra"
paths = ["app/mailers/**"]

''',
    "base": {
        "config/routes.rb": '''
Rails.application.routes.draw do
  resources :orders, only: :create
end
''',
        "app/controllers/application_controller.rb": "class ApplicationController < ActionController::Base\nend\n",
        "app/controllers/orders_controller.rb": '''
class OrdersController < ApplicationController
  def create
    order = Checkout::PlaceOrder.call(params)
    render json: order
  end
end
''',
        "app/services/checkout/place_order.rb": '''
module Checkout
  class PlaceOrder
    def self.call(params)
      order = Order.create!(params)
      Payments::Gateway.charge(order)
      order
    end
  end
end
''',
        "app/models/application_record.rb": "class ApplicationRecord < ActiveRecord::Base\n  primary_abstract_class\nend\n",
        "app/models/order.rb": '''
class Order < ApplicationRecord
  validates :total, numericality: { greater_than: 0 }
end
''',
        "app/clients/payments/gateway.rb": '''
module Payments
  class Gateway
    def self.charge(order)
      client.charges.create(amount: order.total, idempotency_key: "order-#{order.id}")
    end
  end
end
''',
        "app/mailers/order_mailer.rb": "class OrderMailer < ApplicationMailer\nend\n",
    },
    "head": {
        "config/routes.rb": '''
Rails.application.routes.draw do
  resources :orders, only: :create
  resources :refunds, only: :create
end
''',
        "app/controllers/refunds_controller.rb": '''
class RefundsController < ApplicationController
  def create
    refund = Refunds::Create.call(
      order_id: params.require(:order_id),
      amount: params.require(:amount).to_d,
      key: request.headers.fetch("Idempotency-Key")
    )
    render json: refund, status: :created
  end
end
''',
        "app/services/refunds/create.rb": '''
module Refunds
  class Create
    def self.call(order_id:, amount:, key:)
      existing = Refund.find_by(idempotency_key: key)
      return existing if existing

      order = Order.find(order_id)
      refund = order.refund!(amount, key: key)
      Payments::Gateway.refund(order, amount, idempotency_key: key)
      RefundMailer.confirmation(refund).deliver_later
      refund
    end
  end
end
''',
        "app/models/refund.rb": '''
class Refund < ApplicationRecord
  belongs_to :order
  validates :amount, numericality: { greater_than: 0 }
  validates :idempotency_key, presence: true, uniqueness: true
end
''',
        "app/models/order.rb": '''
class Order < ApplicationRecord
  has_many :refunds
  validates :total, numericality: { greater_than: 0 }

  def refund!(amount, key:)
    raise ArgumentError, "amount exceeds refundable total" if amount > refundable_total
    refunds.create!(amount: amount, idempotency_key: key)
  end

  def refundable_total = total - refunds.sum(:amount)
end
''',
        "app/clients/payments/gateway.rb": '''
module Payments
  class Gateway
    def self.charge(order)
      client.charges.create(amount: order.total, idempotency_key: "order-#{order.id}")
    end

    def self.refund(order, amount, idempotency_key:)
      client.refunds.create(charge: order.charge_id, amount: amount, idempotency_key: idempotency_key)
    end
  end
end
''',
        "app/mailers/refund_mailer.rb": '''
class RefundMailer < ApplicationMailer
  def confirmation(refund)
    @refund = refund
    mail to: refund.order.email, subject: "Reembolso confirmado"
  end
end
''',
        "db/migrate/20261001100000_create_refunds.rb": '''
class CreateRefunds < ActiveRecord::Migration[7.2]
  def change
    create_table :refunds do |t|
      t.references :order, null: false, foreign_key: true
      t.decimal :amount, precision: 10, scale: 2, null: false
      t.string :idempotency_key, null: false, index: { unique: true }
      t.timestamps
    end
  end
end
''',
        "spec/services/refunds/create_spec.rb": '''
RSpec.describe Refunds::Create do
  it "is idempotent per key" do
    first = described_class.call(order_id: order.id, amount: 5, key: "k1")
    expect(described_class.call(order_id: order.id, amount: 5, key: "k1")).to eq(first)
  end
end
''',
    },
    "insight": {
        "tldr": "Añade reembolsos parciales de pedidos vía POST /refunds, idempotentes por cabecera Idempotency-Key, con aviso por email al cliente.",
        "intent": "Permitir a soporte devolver parte del importe de un pedido sin duplicar cobros.",
        "story": [
            {"heading": "Nuevo caso de uso Refunds::Create", "body": "Soporte puede devolver parte de un pedido. Un reintento con la misma clave no cobra dos veces.", "stage": "architecture", "focus": ["refunds"], "code": "app/services/refunds/create.rb:4-11"},
            {"heading": "Order ahora calcula lo reembolsable", "body": "La regla de importe vive en el modelo, no en el servicio.", "stage": "architecture", "focus": ["models"], "code": "app/models/order.rb:5-10"},
            {"heading": "Tabla refunds añadida", "body": "Cada reembolso guarda su importe y una clave de idempotencia única. Un pedido tiene 0 o más reembolsos.", "stage": "data", "focus": ["refund"], "code": "db/migrate/20261001100000_create_refunds.rb:3-8"},
            {"heading": "La pasarela recibe la clave de idempotencia", "body": "Gateway.refund propaga Idempotency-Key a la pasarela de pagos.", "stage": "flow:create-refund", "focus": ["#4"], "code": "app/clients/payments/gateway.rb:8-10"},
            {"heading": "El cliente recibe un email al final", "body": "deliver_later: si el SMTP cae, el reembolso no falla.", "stage": "flow:create-refund", "focus": ["#5"]},
            {"heading": "5 componentes, 0 violaciones", "body": "Todas las dependencias nuevas van web → aplicación → dominio/infra.", "stage": "architecture"}],
        "hero": [{"from": "refunds", "to": "payments", "label": "refund + idempotency"}],
        "data_model": {"entities": [
            {"id": "refund", "name": "Refund", "change": "added", "component": "models", "evidence": "db/migrate/20261001100000_create_refunds.rb:1-10",
             "fields": ["+order_id: references", "+amount: decimal(10,2)", "+idempotency_key: string (único)", "+created_at, updated_at"]},
            {"id": "order", "name": "Order", "change": "changed", "component": "models", "evidence": "app/models/order.rb:1-11",
             "fields": ["id", "total: decimal", "+refunds: has_many", "+refundable_total(): total − Σ refunds"]}],
            "relations": [{"from": "order", "to": "refund", "label": "1 → 0..n", "change": "added"}]},
        "changes": [{"id": "controllers", "summary": "Nueva ruta POST /refunds; el controlador exige Idempotency-Key y delega."}, {"id": "refunds", "summary": "Nuevo caso de uso: deduplica por clave, registra el reembolso, llama a la pasarela y avisa."}, {"id": "models", "summary": "Nuevo modelo Refund; Order calcula el importe reembolsable y crea reembolsos."}, {"id": "payments", "summary": "La pasarela expone refund() propagando la clave de idempotencia."}, {"id": "mailers", "summary": "Nuevo email de confirmación de reembolso."}],
        "decisions": [{"title": "Idempotencia por cabecera Idempotency-Key", "why": "El cliente controla los reintentos y la misma clave llega a la pasarela.", "alternative": "Deduplicar por (pedido, importe) en una ventana de tiempo.", "evidence": "app/controllers/refunds_controller.rb:6"}, {"title": "La regla de importe vive en Order", "why": "Order conoce su total y sus reembolsos; el servicio solo coordina las llamadas.", "evidence": "app/models/order.rb:6"}, {"title": "Email en segundo plano", "why": "deliver_later no bloquea la respuesta ni falla el reembolso si el SMTP cae.", "evidence": "app/services/refunds/create.rb:11"}],
        "flows": [{"id": "create-refund", "title": "Crear reembolso", "steps": [
            {"from": "controllers", "to": "refunds", "msg": "Refunds::Create.call", "status": "new", "data": {"type": "RefundParams", "fields": ["+order_id", "+amount", "+idempotency_key"]}},
            {"from": "refunds", "to": "models", "msg": "Refund.find_by(key)", "status": "new"},
            {"from": "refunds", "to": "models", "msg": "order.refund!(amount)", "status": "new", "data": {"type": "Refund", "fields": ["+amount: decimal", "+idempotency_key: string"]}},
            {"from": "refunds", "to": "payments", "msg": "Gateway.refund", "status": "new", "data": {"type": "RefundRequest", "fields": ["+charge", "+amount", "+idempotency_key"]}},
            {"from": "refunds", "to": "mailers", "msg": "RefundMailer.confirmation", "status": "new"}]}]
    },
}

# ───────────────────────── 2. Django without config nor agent: data-only ─────────────────────────
DJANGO = {
    "stack": "Django · no config, no agent", "shows": "Zero setup: components inferred from folders and dependencies from imports. No narrative, only computed facts.",
    "name": "02-ledger-django-no-config",
    "dir": "ledger",
    "branch": "feature/monthly-reports",
    "message": "Monthly statements report",
    "config": None,
    "base": {
        "manage.py": "import os, sys\n",
        "accounts/__init__.py": "",
        "accounts/models.py": "from django.db import models\n\n\nclass Account(models.Model):\n    name = models.CharField(max_length=80)\n",
        "accounts/views.py": "from .models import Account\n\n\ndef detail(request, pk):\n    return Account.objects.get(pk=pk)\n",
        "billing/__init__.py": "",
        "billing/models.py": "from django.db import models\nfrom accounts.models import Account\n\n\nclass Invoice(models.Model):\n    account = models.ForeignKey(Account, on_delete=models.CASCADE)\n    amount = models.DecimalField(max_digits=10, decimal_places=2)\n",
        "billing/services.py": "from .models import Invoice\n\n\ndef open_invoices(account):\n    return Invoice.objects.filter(account=account, paid=False)\n",
        "config/settings.py": "INSTALLED_APPS = ['accounts', 'billing']\n",
        "config/urls.py": "from django.urls import path\nfrom accounts import views\n\nurlpatterns = [path('accounts/<int:pk>/', views.detail)]\n",
    },
    "head": {
        "reports/__init__.py": "",
        "reports/statements.py": '''
from decimal import Decimal

from accounts.models import Account
from billing.models import Invoice
from billing.services import open_invoices


def monthly_statement(account: Account, month):
    invoices = Invoice.objects.filter(account=account, created__month=month)
    return {"account": account.name, "total": sum((i.amount for i in invoices), Decimal(0)),
            "open": open_invoices(account).count()}
''',
        "reports/views.py": '''
from accounts.models import Account

from .statements import monthly_statement


def statement(request, pk, month):
    return monthly_statement(Account.objects.get(pk=pk), month)
''',
        "config/settings.py": "INSTALLED_APPS = ['accounts', 'billing', 'reports']\n",
        "config/urls.py": "from django.urls import path\nfrom accounts import views\nfrom reports import views as report_views\n\nurlpatterns = [\n    path('accounts/<int:pk>/', views.detail),\n    path('accounts/<int:pk>/statements/<int:month>/', report_views.statement),\n]\n",
        "billing/services.py": "from .models import Invoice\n\n\ndef open_invoices(account):\n    return Invoice.objects.filter(account=account, paid=False).select_related('account')\n",
        "reports/tests/test_statements.py": "def test_monthly_statement():\n    assert True\n",
    },
    "insight": None,
}

# ───────────────────────── 3. OpenSpec on Django: spec-driven change, Spanish ─────────────────────────
OPENSPEC = {
    "stack": "Django · OpenSpec", "shows": "An OpenSpec change (proposal, design, tasks, spec deltas) carried by the PR: SDD pipeline, requirement → code traceability, a scenario drawn as a flow and a model change.",
    "name": "03-orders-django-openspec-es",
    "branch": "feature/add-order-confirmation",
    "message": "Confirmación de pedido por email (openspec: add-order-confirmation)",
    "config": '''
[project]
name = "orders"
direction = "Vistas finas; la lógica vive en servicios y modelos; las integraciones externas viven en su propia app."
lang = "es"

[[layers]]
id = "web"
name = "Web"
[[layers]]
id = "application"
name = "Aplicación"
[[layers]]
id = "domain"
name = "Dominio"
[[layers]]
id = "infra"
name = "Infraestructura"

[rules]
allow = ["web -> application", "application -> domain", "application -> infra", "infra -> domain"]

[[components]]
id = "orders-api"
name = "API de pedidos"
layer = "web"
paths = ["orders/views.py", "orders/urls.py"]
[[components]]
id = "orders-svc"
name = "Servicios de pedidos"
layer = "application"
paths = ["orders/services.py"]
[[components]]
id = "orders-model"
name = "Modelo Order"
layer = "domain"
paths = ["orders/models.py", "orders/migrations/**"]
[[components]]
id = "notifications"
name = "Notificaciones"
layer = "infra"
paths = ["notifications/**"]


[[flows]]
id = "create-order"
title = "Crear pedido"
steps = ["orders-api -> orders-svc : create_order", "orders-svc -> orders-model : Order.place"]
''',
    "base": {
        "orders/__init__.py": "",
        "orders/models.py": '''
from django.core.exceptions import ValidationError
from django.db import models


class Order(models.Model):
    total = models.DecimalField(max_digits=10, decimal_places=2)

    @classmethod
    def place(cls, total):
        if total <= 0:
            raise ValidationError("invalid total")
        return cls.objects.create(total=total)
''',
        "orders/services.py": '''
from orders.models import Order


def create_order(total):
    return Order.place(total)
''',
        "orders/views.py": '''
import json

from django.http import JsonResponse

from orders.services import create_order


def create(request):
    data = json.loads(request.body)
    order = create_order(data["total"])
    return JsonResponse({"id": order.id}, status=201)
''',
        "orders/urls.py": '''
from django.urls import path

from orders import views

urlpatterns = [path("orders/", views.create)]
''',
        "orders/tests/test_services.py": "def test_create_order():\n    assert True\n",
        "openspec/project.md": "# Orders\nServicio de pedidos.\n",
        "openspec/specs/orders/spec.md": """
# orders

## Purpose
Creación y ciclo de vida de pedidos.

## Requirements
### Requirement: Crear pedido
El sistema SHALL crear un pedido con total positivo.

#### Scenario: Total inválido
- **WHEN** se crea un pedido con total <= 0
- **THEN** la creación falla
""",
    },
    "head": {
        "orders/models.py": '''
from django.core.exceptions import ValidationError
from django.db import models


class Order(models.Model):
    total = models.DecimalField(max_digits=10, decimal_places=2)
    email = models.EmailField()

    @classmethod
    def place(cls, total, email):
        if total <= 0:
            raise ValidationError("invalid total")
        if "@" not in email:
            raise ValidationError("invalid email")
        return cls.objects.create(total=total, email=email)
''',
        "orders/migrations/0002_order_email.py": '''
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("orders", "0001_initial")]
    operations = [migrations.AddField("order", "email", models.EmailField(default=""), preserve_default=False)]
''',
        "orders/services.py": '''
from django.db import transaction

from notifications.email import send_order_confirmation
from orders.models import Order


def create_order(total, email):
    with transaction.atomic():
        order = Order.place(total, email)
        send_order_confirmation(order)
    return order
''',
        "orders/views.py": '''
import json

from django.http import JsonResponse

from orders.services import create_order


def create(request):
    data = json.loads(request.body)
    order = create_order(data["total"], data["email"])
    return JsonResponse({"id": order.id}, status=201)
''',
        "notifications/__init__.py": "",
        "notifications/email.py": '''
from django.core.mail import send_mail

from orders.models import Order


def send_order_confirmation(order: Order):
    send_mail("Pedido confirmado", f"Pedido {order.id} registrado.", None, [order.email])
''',
        "orders/tests/test_services.py": '''
def test_create_order():
    assert True


def test_rejects_invalid_email():
    assert True


def test_sends_confirmation():
    assert True
''',
        "openspec/changes/add-order-confirmation/proposal.md": """
# Change: Confirmación de pedido por email

## Why
Los clientes no saben si su pedido se registró y abren tickets de soporte para confirmarlo.

## What Changes
- Enviar un email de confirmación al crear un pedido.
- El pedido guarda el email del cliente y lo valida.
- **BREAKING**: `POST /orders/` exige `email`.

## Impact
- Specs: orders
- Código: modelo Order, servicio create_order, nueva app notifications.
""",
        "openspec/changes/add-order-confirmation/design.md": """
## Context
Las integraciones externas viven fuera de la app orders.

## Decisions
### Decision: App notifications para el email
orders llama a una función de notifications; no conoce el backend de email.

### Decision: Notificar al crear el pedido
El email sale en la misma petición que crea el pedido.

## Risks / Trade-offs
- Si el SMTP falla, la petición falla.
""",
        "openspec/changes/add-order-confirmation/tasks.md": """
## 1. Modelo
- [x] 1.1 Añadir email a Order y validarlo
- [x] 1.2 Migración del campo email

## 2. Servicio y notificaciones
- [x] 2.1 create_order envía la confirmación
- [x] 2.2 App notifications con send_order_confirmation
- [ ] 2.3 Reintentos si el SMTP falla

## 3. API
- [x] 3.1 POST /orders/ acepta email
""",
        "openspec/changes/add-order-confirmation/specs/orders/spec.md": """
## ADDED Requirements
### Requirement: Email de confirmación
El sistema SHALL enviar un email de confirmación al cliente cuando se crea un pedido.

#### Scenario: Pedido creado
- **WHEN** se crea un pedido válido
- **THEN** el pedido se guarda
- **AND** el cliente recibe un email de confirmación

#### Scenario: SMTP caído
- **WHEN** el servidor SMTP no responde
- **THEN** el pedido se crea igualmente
- **AND** la confirmación se reintenta más tarde

## MODIFIED Requirements
### Requirement: Crear pedido
El sistema SHALL crear un pedido con total positivo y un email válido del cliente.

#### Scenario: Email inválido
- **WHEN** se crea un pedido con un email sin @
- **THEN** la creación falla
""",
    },
    "insight": {
        "tldr": "Al crear un pedido, create_order envía un email de confirmación con la nueva app notifications. Implementa el change OpenSpec add-order-confirmation salvo los reintentos.",
        "intent": "Que el cliente sepa que su pedido se registró, sin meter el envío de email en la app orders.",
        "story": [
            {"heading": "create_order ahora envía la confirmación", "body": "Después de Order.place llama a send_order_confirmation, en la misma transacción.", "stage": "architecture", "focus": ["orders-svc", "notifications"], "code": "orders/services.py:7-11"},
            {"heading": "App notifications añadida", "body": "Envía el email con send_mail. Depende de Order, en la dirección permitida.", "stage": "architecture", "focus": ["notifications"], "code": "notifications/email.py:1-7"},
            {"heading": "El email sale antes del commit", "body": "send_order_confirmation corre dentro de transaction.atomic. Si el SMTP falla, la transacción se revierte.", "stage": "flow:create-order", "focus": ["#3"], "code": "orders/services.py:8-10"},
            {"heading": "Order ahora exige un email válido", "body": "Nuevo campo email con migración. Order.place rechaza emails sin @.", "stage": "data", "focus": ["order"], "code": "orders/models.py:7-15"},
            {"heading": "2 de 3 escenarios cumplidos", "body": "Falta el escenario 'SMTP caído': no hay reintento y el pedido no se crea. La tarea 2.3 sigue abierta.", "stage": "spec", "focus": ["orders/email-de-confirmacion"]}],
        "hero": [{"from": "orders-svc", "to": "notifications", "label": "envía la confirmación"}],
        "data_model": {"entities": [
            {"id": "order", "name": "Order", "change": "changed", "component": "orders-model", "evidence": "orders/models.py:5-15",
             "fields": ["total: Decimal", "+email: EmailField"]}], "relations": []},
        "changes": [{"id": "orders-api", "summary": "POST /orders/ pasa el email del cliente a create_order."},
                    {"id": "orders-svc", "summary": "create_order recibe el email y envía la confirmación."},
                    {"id": "orders-model", "summary": "Order guarda y valida el email; nueva migración."},
                    {"id": "notifications", "summary": "Nueva app con send_order_confirmation sobre send_mail."}],
        "decisions": [{"title": "Enviar el email dentro de la transacción", "why": "Es lo más simple: no queda un pedido guardado sin aviso.", "alternative": "transaction.on_commit con una tarea en cola y reintentos.", "evidence": "orders/services.py:10"},
                      {"title": "send_mail directo, sin interfaz propia", "why": "Django ya abstrae el backend de email.", "alternative": "Una interfaz Notifier en orders que notifications implementa.", "evidence": "notifications/email.py:7"}],
        "flows": [{"id": "create-order", "title": "Crear pedido", "scenario": "orders/email-de-confirmacion#pedido-creado", "steps": [
            {"from": "orders-api", "to": "orders-svc", "msg": "create_order(total, email)", "status": "changed", "data": {"type": "POST /orders/", "fields": ["total: Decimal", "+email: string"]}},
            {"from": "orders-svc", "to": "orders-model", "msg": "Order.place (valida email)", "status": "changed"},
            {"from": "orders-svc", "to": "notifications", "msg": "send_order_confirmation", "status": "new", "data": {"type": "Order", "fields": ["id", "+email"]}}]}],
        "spec": [
            {"req": "orders/email-de-confirmacion", "status": "partial", "components": ["orders-svc", "notifications"], "tests": ["orders/tests/test_services.py:9"],
             "note": "Escenario 'SMTP caído' sin implementar: no hay reintento y el pedido no se crea."},
            {"req": "orders/crear-pedido", "status": "implemented", "components": ["orders-model", "orders-api"], "tests": ["orders/tests/test_services.py:5"]}]
    },
}


SCENARIOS = [RAILS, DJANGO, OPENSPEC]


def build(sc: dict, tmp: Path, out_dir: Path = HERE) -> dict:
    repo = tmp / sc["name"] / sc.get("dir", "repo")
    repo.mkdir(parents=True)
    sh(["git", "init", "-q", "-b", "main"], repo)
    write(repo, sc["base"])
    if sc["config"]:
        write(repo, {".explain-change.toml": sc["config"]})
    sh(["git", "add", "-A"], repo)
    sh(["git", "commit", "-qm", "base"], repo)
    sh(["git", "checkout", "-qb", sc["branch"]], repo)
    write(repo, sc["head"])
    sh(["git", "add", "-A"], repo)
    sh(["git", "commit", "-qm", sc["message"]], repo)
    out = out_dir / f"{sc['name']}.html"
    sh([sys.executable, str(TOOL), "pr", "--base", "main", "--out", str(out)], repo)
    if sc["insight"]:
        ctx = json.loads((repo / ".explain-change" / "context.json").read_text())
        ins = {"version": 1, "key": ctx["key"], "lang": ctx["config"]["lang"], **sc["insight"]}
        (repo / ".explain-change" / "insight.json").write_text(json.dumps(ins, ensure_ascii=False, indent=1))
        res = subprocess.run([sys.executable, str(TOOL), "render", "--out", str(out)], cwd=repo, capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit(f"{sc['name']}: insight rejected\n{res.stdout}")
    ctx = json.loads((repo / ".explain-change" / "context.json").read_text())
    (out_dir / f"{sc['name']}.context.json").write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8") if out_dir != HERE else None
    st = ctx["stats"]
    return {"file": out.name, "project": ctx["config"]["name"], "branch": ctx["source"]["title"],
            "kind": "story" if sc["insight"] else "data-only",
            "stack": sc["stack"], "shows": sc["shows"], "files": st["files"], "add": st["add"], "del": st["del"],
            "components": sum(1 for c in ctx["components"] if c["status"] != "context"),
            "violations": st["violations_new"], "lang": ctx["config"]["lang"]}


GALLERY_CSS = """
:root {
  --bg: #f6f6f3; --surface: #ffffff; --border: #e3e3dd; --text: #1c1c1f; --muted: #6a6a70; --accent: #4b4fd6; --accent-bg: #ececfb;
  --new: #17803d; --violation: #d12a2a; --neutral-bg: #efeff0;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5; --accent-bg: rgba(139,143,245,.14);
  --new: #4cc97a; --violation: #f26b6b; --neutral-bg: rgba(141,141,150,.14); color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #111113; --surface: #19191c; --border: #2b2b30; --text: #ececef; --muted: #a0a0a8; --accent: #8b8ff5; --accent-bg: rgba(139,143,245,.14);
  --new: #4cc97a; --violation: #f26b6b; --neutral-bg: rgba(141,141,150,.14); color-scheme: dark; }
body { background: var(--bg); color: var(--text); font: 15px/1.55 var(--font); }
.wrap { max-width: 860px; margin: 0 auto; padding-inline: 16px; padding-block: 40px 64px; }
h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: -.01em; text-wrap: balance; }
.lead { color: var(--muted); margin: 0 0 28px; max-width: 62ch; }
.list { display: grid; gap: 12px; }
a.item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 16px; padding: 16px 18px; background: var(--surface);
  border: 1px solid var(--border); border-radius: 12px; color: inherit; text-decoration: none; }
a.item:hover, a.item:focus-visible { border-color: var(--accent); outline: none; }
.top { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; min-width: 0; }
.name { font-weight: 650; }
.branch { font-family: var(--mono); font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.stack { grid-column: 1 / -1; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.shows { grid-column: 1 / -1; margin: 0; max-width: 70ch; }
.stats { grid-column: 1 / -1; display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
.add { color: var(--new); } .del { color: var(--violation); }
.badge { align-self: start; padding: 2px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600; white-space: nowrap; }
.story { background: var(--accent-bg); color: var(--accent); } .data-only { background: var(--neutral-bg); color: var(--muted); }
h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 12px; }
.foot { margin-top: 28px; font-size: 13px; color: var(--muted); }
code { font-family: var(--mono); font-size: .9em; }
"""


def gallery(real, rows) -> str:
    from html import escape as e
    label = {"story": "With story", "data-only": "No story"}
    def cards(rows):
        return "".join(
        f'<a class="item" href="{e(r["file"])}"><div class="top"><span class="name">{e(r["project"])}</span>'
        f'<span class="branch">{e(r["branch"])}</span></div><span class="badge {r["kind"]}">{label[r["kind"]]}</span>'
        f'<div class="stack">{e(r["stack"])}</div><p class="shows">{e(r["shows"])}</p>'
        f'<div class="stats"><span>{r["files"]} files</span><span><span class="add">+{r["add"]}</span> '
        f'<span class="del">−{r["del"]}</span></span><span>{r["components"]} components</span>'
        + (f'<span>{r["violations"]} broken rules</span>' if r["violations"] else "") + '</div></a>' for r in rows)
    items = (('<h2>Real projects</h2><div class="list">' + cards(real) + "</div>") if real else "") + \
        '<h2>Synthetic scenarios</h2><div class="list">' + cards(rows) + "</div>"
    return (f"<title>explain-change examples</title>\n<style>{GALLERY_CSS}</style>\n<main class=\"wrap\">"
            "<h1>explain-change examples</h1><p class=\"lead\">Real open-source pull requests and synthetic changes, rendered by the same template. "
            "Each report is a single offline HTML file: an animated map (architecture lanes, data flows and, for spec-driven "
            "changes, OpenSpec requirements traced to code) driven by a step-by-step story, then the design decisions "
            "behind the change.</p>"
            f"{items}"
            "<p class=\"foot\">Generated by <code>examples/build_examples.py</code>.</p></main>\n")


# Real open-source PRs, collected with `explain-change pr` and an agent-written insight. Their config and insight
# live in examples/real/<name>/, with the steps to regenerate them.
REAL = [
    {"file": "real-maybe-rails-data-exports.html", "project": "maybe (Rails)", "branch": "Data exports (#2517)",
     "kind": "story", "stack": "Real project · Ruby on Rails", "files": 20, "add": 706, "del": 1, "components": 5,
     "violations": 0, "shows": "Controller, background job, the Family domain and a new FamilyExport table. "
     "Config and insight in examples/real/maybe-data-exports."},
    {"file": "real-healthchecks-django-desc-limit.html", "project": "healthchecks (Django)",
     "branch": "Description length limit", "kind": "story", "stack": "Real project · Django", "files": 10,
     "add": 36, "del": 11, "components": 3, "violations": 0,
     "shows": "A small validation change across the API, the dashboard and a template, configured with CONFIGURE.md. "
     "Config and insight in examples/real/healthchecks-desc-limit."},
]


def main():
    tmp = Path(tempfile.mkdtemp(prefix="explain-change-examples-"))
    try:
        rows = [build(sc, tmp) for sc in SCENARIOS]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    real = [r for r in REAL if (HERE / r["file"]).exists()]
    (HERE / "index.html").write_text(gallery(real, rows), encoding="utf-8", newline="\n")
    for r in rows:
        print(f"{r['file']}: {r['kind']}, {r['files']} files, {r['violations']} broken rules")


if __name__ == "__main__":
    main()
