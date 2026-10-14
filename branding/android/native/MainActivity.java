package com.rayzeng.animationstudio;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFileSaverPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
