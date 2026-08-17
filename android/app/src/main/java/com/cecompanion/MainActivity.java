package com.cecompanion;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundPoller.class);
        super.onCreate(savedInstanceState);
    }
}