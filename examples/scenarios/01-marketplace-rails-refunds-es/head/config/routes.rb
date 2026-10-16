Rails.application.routes.draw do
  resources :orders, only: :create
  resources :refunds, only: :create
end
