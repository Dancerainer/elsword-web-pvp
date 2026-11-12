// ABI verified against Microsoft.DXSDK.D3DX 9.29.952.8 d3dx9anim.h.
// All track integration and pose mixing below executes the loaded D3DX DLL.
// This file only supplies keys, calls the COM ABI, and records returned data.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class D3dxAnimationProbe
{
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr LoadLibrary(string path);
    [DllImport("kernel32.dll", CharSet=CharSet.Ansi, SetLastError=true)]
    static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("d3d9.dll")] static extern IntPtr Direct3DCreate9(uint sdk);
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex,string cls,string name,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr parameter);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateController(uint outputs,uint sets,uint tracks,uint events,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateSet([MarshalAs(UnmanagedType.LPStr)] string name,double ticks,uint playback,uint animations,uint callbacks,IntPtr keys,out IntPtr result);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint Release(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int NoArgs(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate double DoubleResult(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr NameResult(IntPtr self);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterOutput(IntPtr self,[MarshalAs(UnmanagedType.LPStr)] string name,IntPtr matrix,IntPtr scale,IntPtr rotation,IntPtr translation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterSet(IntPtr self,IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetAnimation(IntPtr self,uint track,IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackFloat(IntPtr self,uint track,float value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackDouble(IntPtr self,uint track,double value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackBool(IntPtr self,uint track,int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TrackOnly(IntPtr self,uint track);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Advance(IntPtr self,double elapsed,IntPtr callback);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetTrack(IntPtr self,uint track,out TrackDesc desc);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyFloat(IntPtr self,uint track,float value,double start,double duration,uint transition);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyEnable(IntPtr self,uint track,int value,double start);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int RegisterKeys(IntPtr self,[MarshalAs(UnmanagedType.LPStr)] string name,uint scaleCount,uint rotationCount,uint translationCount,IntPtr scale,IntPtr rotation,IntPtr translation,out uint index);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int LoadHierarchy(IntPtr bytes,uint length,uint meshOptions,IntPtr device,IntPtr allocate,IntPtr userData,out IntPtr root,out IntPtr controller);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateFrame(IntPtr self,IntPtr name,out IntPtr frame);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateMesh(IntPtr self,IntPtr name,IntPtr data,IntPtr materials,IntPtr effects,uint materialCount,IntPtr adjacency,IntPtr skin,out IntPtr mesh);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Destroy(IntPtr self,IntPtr item);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DestroyHierarchy(IntPtr root,IntPtr allocate);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSet(IntPtr self,uint index,out IntPtr set);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetSrt(IntPtr self,double position,uint animation,IntPtr scale,IntPtr rotation,IntPtr translation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AnimationName(IntPtr self,uint index,out IntPtr name);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint KeyCount(IntPtr self,uint animation);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetKeys(IntPtr self,uint animation,IntPtr keys);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int CreateDevice(IntPtr self,uint adapter,uint type,IntPtr focus,uint flags,ref PresentParameters parameters,out IntPtr device);
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct PresentParameters {public uint Width,Height,Format,Count,MultiSampleType,MultiSampleQuality,SwapEffect;public IntPtr DeviceWindow;public int Windowed,AutoDepth;public uint DepthFormat,Flags,RefreshRate,Interval;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct FrameData {public IntPtr Name;[MarshalAs(UnmanagedType.ByValArray,SizeConst=16)]public float[] Matrix;public IntPtr Mesh,Sibling,Child;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct MeshData {public uint Type;public IntPtr Mesh;}
    [StructLayout(LayoutKind.Sequential,Pack=4)] struct MeshContainer {public IntPtr Name;public MeshData Data;public IntPtr Materials,Effects;public uint MaterialCount;public IntPtr Adjacency,Skin,Next;}

    // ID3DXAllocateHierarchy has four virtual methods and no IUnknown prefix.
    // A raw SDK-shaped vtable avoids adding COM CCW QueryInterface slots.
    sealed class Allocator:IDisposable {
        public IntPtr Pointer;IntPtr table;List<Delegate> callbacks=new List<Delegate>();HashSet<IntPtr> frames=new HashSet<IntPtr>(),meshes=new HashSet<IntPtr>();
        public Allocator(){
            callbacks.Add(new CreateFrame(Frame));callbacks.Add(new CreateMesh(Mesh));callbacks.Add(new Destroy(FreeFrame));callbacks.Add(new Destroy(FreeMesh));
            table=Marshal.AllocHGlobal(4*IntPtr.Size);Pointer=Marshal.AllocHGlobal(IntPtr.Size);
            for(int i=0;i<4;i++)Marshal.WriteIntPtr(table,i*IntPtr.Size,Marshal.GetFunctionPointerForDelegate(callbacks[i]));Marshal.WriteIntPtr(Pointer,table);
        }
        int Frame(IntPtr self,IntPtr name,out IntPtr frame){
            frame=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FrameData)));string text=Marshal.PtrToStringAnsi(name);
            FrameData data=new FrameData{Name=text==null?IntPtr.Zero:Marshal.StringToHGlobalAnsi(text),Matrix=new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1}};
            Marshal.StructureToPtr(data,frame,false);frames.Add(frame);return 0;
        }
        int Mesh(IntPtr self,IntPtr name,IntPtr data,IntPtr materials,IntPtr effects,uint count,IntPtr adjacency,IntPtr skin,out IntPtr mesh){
            MeshData input=(MeshData)Marshal.PtrToStructure(data,typeof(MeshData));
            if(input.Mesh!=IntPtr.Zero)V<Release>(input.Mesh,1)(input.Mesh);if(skin!=IntPtr.Zero)V<Release>(skin,1)(skin);
            string text=Marshal.PtrToStringAnsi(name);var container=new MeshContainer{Name=text==null?IntPtr.Zero:Marshal.StringToHGlobalAnsi(text),Data=input,Skin=skin};
            // Materials/adjacency are presentation data. The probe never renders;
            // retain the real mesh/skin COM references for valid loader lifetime.
            mesh=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(MeshContainer)));Marshal.StructureToPtr(container,mesh,false);meshes.Add(mesh);return 0;
        }
        int FreeFrame(IntPtr self,IntPtr frame){if(frames.Remove(frame)){FrameData data=(FrameData)Marshal.PtrToStructure(frame,typeof(FrameData));if(data.Name!=IntPtr.Zero)Marshal.FreeHGlobal(data.Name);Marshal.FreeHGlobal(frame);}return 0;}
        int FreeMesh(IntPtr self,IntPtr mesh){if(meshes.Remove(mesh)){var data=(MeshContainer)Marshal.PtrToStructure(mesh,typeof(MeshContainer));if(data.Name!=IntPtr.Zero)Marshal.FreeHGlobal(data.Name);if(data.Data.Mesh!=IntPtr.Zero)V<Release>(data.Data.Mesh,2)(data.Data.Mesh);if(data.Skin!=IntPtr.Zero)V<Release>(data.Skin,2)(data.Skin);Marshal.FreeHGlobal(mesh);}return 0;}
        public void Dispose(){foreach(IntPtr mesh in new List<IntPtr>(meshes))FreeMesh(Pointer,mesh);foreach(IntPtr frame in new List<IntPtr>(frames))FreeFrame(Pointer,frame);Marshal.FreeHGlobal(Pointer);Marshal.FreeHGlobal(table);GC.KeepAlive(callbacks);}
    }

    [StructLayout(LayoutKind.Sequential,Pack=8)] public struct TrackDesc {
        public uint Priority; public float Weight; public float Speed; public double Position; public int Enable;
    }
    static T V<T>(IntPtr instance,int slot) where T:class {
        IntPtr table=Marshal.ReadIntPtr(instance);
        return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,slot*IntPtr.Size),typeof(T)) as T;
    }
    static T Export<T>(IntPtr module,string name) where T:class {
        IntPtr fn=GetProcAddress(module,name); if(fn==IntPtr.Zero)throw new Exception("Missing DLL export "+name);
        return Marshal.GetDelegateForFunctionPointer(fn,typeof(T)) as T;
    }
    static void Hr(int value,string call) { if(value<0)throw new Exception(call+" HRESULT 0x"+value.ToString("X8")); }
    static IntPtr Floats(float[] data) { IntPtr p=Marshal.AllocHGlobal(data.Length*4);Marshal.Copy(data,0,p,data.Length);return p; }
    static float[] Read(IntPtr p,int count) { float[] a=new float[count];Marshal.Copy(p,a,0,count);return a; }
    static Dictionary<string,object> KeySummary(IntPtr set,uint animation,int countSlot,int readSlot,int width) {
        uint count=V<KeyCount>(set,countSlot)(set,animation);var result=new Dictionary<string,object>{{"count",count}};if(count==0)return result;
        IntPtr pointer=Marshal.AllocHGlobal((int)count*width*4);
        try{Hr(V<GetKeys>(set,readSlot)(set,animation,pointer),"GetOriginalKeys");float[] keys=Read(pointer,(int)count*width);float[] first=new float[width],last=new float[width];Array.Copy(keys,first,width);Array.Copy(keys,keys.Length-width,last,0,width);result.Add("firstTimeAndValue",first);result.Add("lastTimeAndValue",last);result.Add("keys",keys);result.Add("keyStrideFloats",width);byte[] raw=new byte[keys.Length*4];Marshal.Copy(pointer,raw,0,raw.Length);result.Add("keyBytesBase64",Convert.ToBase64String(raw));using(var sha=System.Security.Cryptography.SHA256.Create())result.Add("keyBytesSha256",BitConverter.ToString(sha.ComputeHash(raw)).Replace("-","").ToLowerInvariant());}
        finally{Marshal.FreeHGlobal(pointer);}return result;
    }

    sealed class Controller:IDisposable {
        public IntPtr Pointer; IntPtr scale,rotation,translation,matrix; List<IntPtr> sets=new List<IntPtr>();List<Dictionary<string,object>> inputs=new List<Dictionary<string,object>>();
        public Controller(IntPtr module) {
            Hr(Export<CreateController>(module,"D3DXCreateAnimationController")(1,4,2,30,out Pointer),"CreateAnimationController");
            scale=Floats(new float[]{1,1,1});rotation=Floats(new float[]{0,0,0,1});translation=Floats(new float[]{0,0,0});
            matrix=Floats(new float[]{1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1});
            Hr(V<RegisterOutput>(Pointer,7)(Pointer,"Bip01",matrix,scale,rotation,translation),"RegisterAnimationOutput");
        }
        public IntPtr Add(IntPtr module,string name,float x,float[] s,float[] q,bool moving,bool varyingRotation=false) {
            IntPtr set; Hr(Export<CreateSet>(module,"D3DXCreateKeyframedAnimationSet")(name,1,0,1,0,IntPtr.Zero,out set),"CreateKeyframedAnimationSet");
            sets.Add(set);
            float[] sv={0,s[0],s[1],s[2],10,s[0],s[1],s[2]},rv={0,varyingRotation?0:q[0],varyingRotation?0:q[1],varyingRotation?0:q[2],varyingRotation?1:q[3],10,q[0],q[1],q[2],q[3]},tv={0,x,0,0,10,x+(moving?100:0),0,0};
            inputs.Add(new Dictionary<string,object>{{"name",name},{"bone","Bip01"},{"ticksPerSecond",1},{"playback",0},{"scaleTimeXYZ",sv},{"rotationTimeXYZW",rv},{"translationTimeXYZ",tv}});
            IntPtr sk=Floats(sv),rk=Floats(rv),tk=Floats(tv);
            try { uint index;Hr(V<RegisterKeys>(set,32)(set,"Bip01",2,2,2,sk,rk,tk,out index),"RegisterAnimationSRTKeys"); }
            finally {Marshal.FreeHGlobal(sk);Marshal.FreeHGlobal(rk);Marshal.FreeHGlobal(tk);}
            Hr(V<RegisterSet>(Pointer,8)(Pointer,set),"RegisterAnimationSet");return set;
        }
        public void Set(uint track,IntPtr set,float weight,float speed,double position) {
            Hr(V<SetAnimation>(Pointer,16)(Pointer,track,set),"SetTrackAnimationSet");
            Hr(V<TrackFloat>(Pointer,19)(Pointer,track,speed),"SetTrackSpeed");
            Hr(V<TrackFloat>(Pointer,20)(Pointer,track,weight),"SetTrackWeight");
            Hr(V<TrackDouble>(Pointer,21)(Pointer,track,position),"SetTrackPosition");
            Hr(V<TrackBool>(Pointer,22)(Pointer,track,1),"SetTrackEnable");
        }
        public void Step(double dt) {Hr(V<Advance>(Pointer,13)(Pointer,dt,IntPtr.Zero),"AdvanceTime");}
        public Dictionary<string,object> Srt(IntPtr set,double t) {Hr(V<GetSrt>(set,9)(set,t,0,scale,rotation,translation),"GetSRT");return new Dictionary<string,object>{{"position",t},{"scale",Read(scale,3)},{"rotation",Read(rotation,4)},{"translation",Read(translation,3)}};}
        public void Reset() {Hr(V<NoArgs>(Pointer,14)(Pointer),"ResetTime");for(uint t=0;t<2;t++)Hr(V<TrackOnly>(Pointer,33)(Pointer,t),"UnkeyAllTrackEvents");}
        public uint Speed(uint track,float target,double start,double duration) {return V<KeyFloat>(Pointer,27)(Pointer,track,target,start,duration,0);}
        public uint Weight(uint track,float target,double start,double duration) {return V<KeyFloat>(Pointer,28)(Pointer,track,target,start,duration,0);}
        public void Change(uint oldTrack,IntPtr incoming,float nominal,double duration) {
            uint next=1-oldTrack;Reset();
            V<KeyEnable>(Pointer,30)(Pointer,oldTrack,0,duration);
            Speed(oldTrack,0,0,duration);Weight(oldTrack,0,0,duration);
            Set(next,incoming,0,0,0);Speed(next,nominal,0,duration);Weight(next,1,0,duration);
        }
        public Dictionary<string,object> Snapshot(string label) {
            TrackDesc a,b;Hr(V<GetTrack>(Pointer,24)(Pointer,0,out a),"GetTrackDesc0");Hr(V<GetTrack>(Pointer,24)(Pointer,1,out b),"GetTrackDesc1");
            return new Dictionary<string,object>{{"label",label},{"inputs",inputs},{"controllerTime",V<DoubleResult>(Pointer,15)(Pointer)},{"track0",a},{"track1",b},{"scale",Read(scale,3)},{"rotation",Read(rotation,4)},{"translation",Read(translation,3)},{"matrix",Read(matrix,16)}};
        }
        public void Dispose() {if(Pointer!=IntPtr.Zero){V<Release>(Pointer,2)(Pointer);Pointer=IntPtr.Zero;}foreach(IntPtr s in sets)V<Release>(s,2)(s);Marshal.FreeHGlobal(scale);Marshal.FreeHGlobal(rotation);Marshal.FreeHGlobal(translation);Marshal.FreeHGlobal(matrix);}
    }

    public static List<Dictionary<string,object>> Run(string dll,string[] actualXs) {
        if(IntPtr.Size!=4)throw new Exception("Use the 32-bit Windows PowerShell host for the original client DLL");
        if(Marshal.SizeOf(typeof(TrackDesc))!=32||Marshal.OffsetOf(typeof(TrackDesc),"Position").ToInt32()!=16)throw new Exception("D3DXTRACK_DESC ABI mismatch");
        IntPtr module=LoadLibrary(dll);if(module==IntPtr.Zero)throw new Exception("LoadLibrary error "+Marshal.GetLastWin32Error());
        var result=new List<Dictionary<string,object>>();
        float[] unit={1,1,1},identity={0,0,0,1},turnZ={0,0,1,0},turnY={0,1,0,0};
        using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,false);var b=c.Add(module,"B",100,new float[]{3,5,7},turnZ,false);
            c.Set(0,a,.75f,0,0);c.Set(1,b,.25f,0,0);c.Step(0);result.Add(c.Snapshot("two-track-SRT-weights-.75-.25"));
            c.Set(0,a,.25f,0,0);c.Set(1,b,.25f,0,0);c.Step(0);result.Add(c.Snapshot("weights-total-.5"));
            c.Set(0,a,0,0,0);c.Set(1,b,0,0,0);c.Step(0);result.Add(c.Snapshot("zero-total-weight"));
        }
        foreach(float sign in new float[]{1,-1})using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,false);var b=c.Add(module,"B",100,unit,new float[]{0,0,sign*.70710677f,.70710677f},false);
            c.Set(0,a,.75f,0,0);c.Set(1,b,.25f,0,0);c.Step(0);result.Add(c.Snapshot("non180-quaternion-quarter-sign-"+sign));
            c.Set(0,a,.1875f,0,0);c.Set(1,b,.25f,0,0);c.Step(0);result.Add(c.Snapshot("partial-track-weights-sign-"+sign));
        }
        using(var c=new Controller(module)) {
            var a=c.Add(module,"varyingQuaternion",0,unit,new float[]{0,0,.70710677f,.70710677f},false,true);
            c.Set(0,a,1,0,2.5);c.Step(0);var row=c.Snapshot("within-keyframe-quarter-interpolation");row.Add("animationSetGetSRT",c.Srt(a,2.5));result.Add(row);
        }
        // Author assets can contain nonunit compressed/decomposed rotations.
        // Distinguish raw GetSRT endpoints from the controller's output matrix.
        foreach(bool varying in new bool[]{false,true})using(var c=new Controller(module)) {
            var a=c.Add(module,"nonunitQuaternion",0,unit,new float[]{0,0,.353553385f,.353553385f},false,varying);
            foreach(double position in new double[]{0,2.5,5,9.99999}) {
                c.Set(0,a,1,0,position);c.Step(0);var row=c.Snapshot("nonunit-quaternion-"+(varying?"varying":"constant")+"-"+position.ToString(System.Globalization.CultureInfo.InvariantCulture));
                row.Add("animationSetGetSRT",c.Srt(a,position));result.Add(row);
            }
        }
        foreach(double position in new double[]{0,2.5})using(var c=new Controller(module)) {
            var a=c.Add(module,"unitQuaternion",0,unit,identity,false);var b=c.Add(module,"halfQuaternion",100,unit,new float[]{0,0,.353553385f,.353553385f},false);
            c.Set(0,a,.75f,0,position);c.Set(1,b,.25f,0,position);c.Step(0);result.Add(c.Snapshot("nonunit-two-track-quarter-"+position.ToString(System.Globalization.CultureInfo.InvariantCulture)));
        }
        using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,true);var b=c.Add(module,"B",100,unit,turnZ,true);
            c.Set(0,a,1,1,.4);c.Change(0,b,1,.1);c.Step(.025);result.Add(c.Snapshot("ChangeAnim-quarter-transition"));
            c.Step(0);result.Add(c.Snapshot("AdvanceTime-zero-freeze"));
            c.Step(.025);result.Add(c.Snapshot("ChangeAnim-half-transition"));
            c.Step(.05);result.Add(c.Snapshot("ChangeAnim-transition-end"));
        }
        using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,false);var b=c.Add(module,"B",100,unit,turnZ,false);var d=c.Add(module,"C",200,unit,turnY,false);
            c.Set(0,a,1,1,.4);c.Change(0,b,1,.1);c.Step(.025);result.Add(c.Snapshot("rapid-before-interrupt"));
            c.Change(1,d,1,.1);c.Step(0);result.Add(c.Snapshot("rapid-after-interrupt-zero"));
            c.Step(.025);result.Add(c.Snapshot("rapid-quarter-new-transition"));
            c.Step(.025);result.Add(c.Snapshot("rapid-half-new-transition"));
            c.Step(.05);result.Add(c.Snapshot("rapid-new-transition-end"));
        }
        using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,true);var b=c.Add(module,"B",100,unit,identity,true);
            c.Set(0,a,1,1,0);c.Change(0,b,1,.1);uint handle=c.Speed(1,2,0,.2);
            c.Step(.025);var row=c.Snapshot("SetPlaySpeed-after-ChangeAnim-quarter");row.Add("speedEventHandle",handle);result.Add(row);
            c.Step(.025);result.Add(c.Snapshot("SetPlaySpeed-after-ChangeAnim-half"));
            c.Step(.05);result.Add(c.Snapshot("SetPlaySpeed-after-ChangeAnim-old-weight-end"));
            c.Step(.1);result.Add(c.Snapshot("SetPlaySpeed-after-ChangeAnim-new-speed-end"));
        }
        using(var c=new Controller(module)) {
            var a=c.Add(module,"A",0,unit,identity,true);c.Set(0,a,1,1,.5);c.Speed(0,2,.5,.1);
            c.Step(.25);result.Add(c.Snapshot("SetPlaySpeed-current-track-time-key-global-.25"));
            c.Step(.25);result.Add(c.Snapshot("SetPlaySpeed-current-track-time-key-global-.5"));
            c.Step(.025);result.Add(c.Snapshot("SetPlaySpeed-current-track-time-key-global-.525"));
        }
        IntPtr d3d=Direct3DCreate9(32),device=IntPtr.Zero,window=CreateWindowEx(0,"STATIC","D3DX animation probe (hidden)",0,0,0,1,1,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        int deviceHr=unchecked((int)0x8876086c);
        if(d3d!=IntPtr.Zero&&window!=IntPtr.Zero){var pp=new PresentParameters{Width=1,Height=1,Count=1,SwapEffect=1,DeviceWindow=window,Windowed=1};deviceHr=V<CreateDevice>(d3d,16)(d3d,0,4,window,0x20,ref pp,out device);}
        using(var allocator=new Allocator()) {
            string text="xof 0303txt 0032\nFrame Scene_Root { FrameTransformMatrix { 1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1;; } } AnimationSet Normal { Animation { { Scene_Root } AnimationKey { 2; 2; 0;3;0,0,0;;, 10;3;10,0,0;;; } } }";
            byte[] ascii=System.Text.Encoding.ASCII.GetBytes(text);IntPtr memory=Marshal.AllocHGlobal(ascii.Length);Marshal.Copy(ascii,0,memory,ascii.Length);
            IntPtr hierarchy=IntPtr.Zero,controller=IntPtr.Zero;
            try {
                int hr=Export<LoadHierarchy>(module,"D3DXLoadMeshHierarchyFromXInMemory")(memory,(uint)ascii.Length,0,device,allocator.Pointer,IntPtr.Zero,out hierarchy,out controller);
                var row=new Dictionary<string,object>{{"label","X-without-AnimTicksPerSecond"},{"fixture",text},{"hresult","0x"+hr.ToString("X8")},{"device","D3DDEVTYPE_NULLREF; hidden 1x1 HWND; never rendered/presented"},{"createDeviceHresult","0x"+deviceHr.ToString("X8")}};
                if(hr>=0&&controller!=IntPtr.Zero){IntPtr set;Hr(V<GetSet>(controller,11)(controller,0,out set),"GetLoadedAnimationSet");try{row.Add("period",V<DoubleResult>(set,4)(set));row.Add("ticksPerSecond",V<DoubleResult>(set,12)(set));}finally{V<Release>(set,2)(set);}}
                result.Add(row);
            }finally {if(controller!=IntPtr.Zero)V<Release>(controller,2)(controller);if(hierarchy!=IntPtr.Zero)Export<DestroyHierarchy>(module,"D3DXFrameDestroy")(hierarchy,allocator.Pointer);Marshal.FreeHGlobal(memory);}
        }
        foreach(string source in actualXs)using(var allocator=new Allocator()) {
            byte[] bytes=System.IO.File.ReadAllBytes(source);IntPtr memory=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,memory,bytes.Length);
            IntPtr hierarchy=IntPtr.Zero,controller=IntPtr.Zero;
            try{
                int hr=Export<LoadHierarchy>(module,"D3DXLoadMeshHierarchyFromXInMemory")(memory,(uint)bytes.Length,0x110,device,allocator.Pointer,IntPtr.Zero,out hierarchy,out controller);
                var row=new Dictionary<string,object>{{"label","original-X-loader-"+System.IO.Path.GetFileName(source)},{"source",source},{"hresult","0x"+hr.ToString("X8")},{"device","D3DDEVTYPE_NULLREF; hidden 1x1 HWND; never rendered/presented"}};
                if(hr>=0&&controller!=IntPtr.Zero){
                    uint count=V<Release>(controller,10)(controller);var animations=new List<Dictionary<string,object>>();
                    for(uint i=0;i<count;i++){IntPtr set;Hr(V<GetSet>(controller,11)(controller,i,out set),"GetOriginalAnimationSet");try{
                        double period=V<DoubleResult>(set,4)(set);uint bones=V<Release>(set,6)(set);var channels=new List<Dictionary<string,object>>();
                        IntPtr s=Floats(unit),q=Floats(identity),t=Floats(new float[]{0,0,0});
                        try{for(uint bone=0;bone<bones;bone++){IntPtr name;Hr(V<AnimationName>(set,7)(set,bone,out name),"GetAnimationNameByIndex");var channel=new Dictionary<string,object>{{"name",Marshal.PtrToStringAnsi(name)},{"scaleKeys",KeySummary(set,bone,13,14,4)},{"rotationKeys",KeySummary(set,bone,17,18,5)},{"translationKeys",KeySummary(set,bone,21,22,4)}};
                            var poses=new List<Dictionary<string,object>>();foreach(double fraction in new double[]{0,.23,.61,.999999}){double time=period*fraction;Hr(V<GetSrt>(set,9)(set,time,bone,s,q,t),"OriginalGetSRT");poses.Add(new Dictionary<string,object>{{"timeSeconds",time},{"scale",Read(s,3)},{"rotation",Read(q,4)},{"translation",Read(t,3)}});}channel.Add("poses",poses);channels.Add(channel);
                        }}finally{Marshal.FreeHGlobal(s);Marshal.FreeHGlobal(q);Marshal.FreeHGlobal(t);}
                        animations.Add(new Dictionary<string,object>{{"index",i},{"name",Marshal.PtrToStringAnsi(V<NameResult>(set,3)(set))},{"playbackType",V<Release>(set,11)(set)},{"period",period},{"ticksPerSecond",V<DoubleResult>(set,12)(set)},{"channels",channels}});
                    }finally{V<Release>(set,2)(set);}}
                    row.Add("animations",animations);
                }
                result.Add(row);
            }finally {if(controller!=IntPtr.Zero)V<Release>(controller,2)(controller);if(hierarchy!=IntPtr.Zero)Export<DestroyHierarchy>(module,"D3DXFrameDestroy")(hierarchy,allocator.Pointer);Marshal.FreeHGlobal(memory);}
        }
        if(device!=IntPtr.Zero)V<Release>(device,2)(device);if(d3d!=IntPtr.Zero)V<Release>(d3d,2)(d3d);if(window!=IntPtr.Zero)DestroyWindow(window);
        return result;
    }
}
