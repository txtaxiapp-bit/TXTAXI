
package com.brtxtaxi

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import androidx.appcompat.app.AppCompatActivity
import com.brtxtaxi.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Configuração do WebView para rodar a lógica do Taxímetro
        val webView: WebView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.setGeolocationEnabled(true)
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        
        // Permite que o WebView acesse o GPS do Android
        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                callback.invoke(origin, true, false)
            }
        }

        webView.webViewClient = WebViewClient()
        
        // Carrega o arquivo index.html da pasta assets
        webView.loadUrl("file:///android_asset/index.html")

        // Substitui o conteúdo principal pelo nosso WebView
        setContentView(webView)
    }
}
